package app.vibe80.android.data

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import app.vibe80.shared.models.Attachment
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.asRequestBody
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

class AttachmentUploader(
    private val context: Context,
    private val baseUrl: String
) {
    private val client = OkHttpClient.Builder()
        .build()

    suspend fun uploadFiles(
        sessionId: String,
        fileUris: List<Uri>
    ): List<Attachment> = withContext(Dispatchers.IO) {
        if (fileUris.isEmpty()) return@withContext emptyList()

        val tempFiles = mutableListOf<File>()
        try {
            val multipartBuilder = MultipartBody.Builder()
                .setType(MultipartBody.FORM)

            for (uri in fileUris) {
                val fileInfo = getFileInfo(uri)
                val tempFile = copyToTempFile(uri, fileInfo.name)
                tempFiles.add(tempFile)

                val mediaType = (fileInfo.mimeType ?: "application/octet-stream").toMediaType()
                multipartBuilder.addFormDataPart(
                    "files",
                    fileInfo.name,
                    tempFile.asRequestBody(mediaType)
                )
            }

            val request = Request.Builder()
                .url("$baseUrl/api/attachments/upload?session=$sessionId")
                .post(multipartBuilder.build())
                .build()

            val response = client.newCall(request).execute()

            if (!response.isSuccessful) {
                throw Exception("Upload failed: ${response.code}")
            }

            val body = response.body?.string() ?: throw Exception("Empty response")
            parseUploadResponse(body)
        } finally {
            tempFiles.forEach { it.delete() }
        }
    }

    private fun getFileInfo(uri: Uri): FileInfo {
        var name = "attachment"
        var size: Long = 0
        var mimeType: String? = null

        context.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                val sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE)

                if (nameIndex >= 0) {
                    name = cursor.getString(nameIndex) ?: "attachment"
                }
                if (sizeIndex >= 0) {
                    size = cursor.getLong(sizeIndex)
                }
            }
        }

        mimeType = context.contentResolver.getType(uri)

        return FileInfo(name, size, mimeType)
    }

    private fun copyToTempFile(uri: Uri, name: String): File {
        val tempFile = File.createTempFile("upload_", "_$name", context.cacheDir)
        context.contentResolver.openInputStream(uri)?.use { input ->
            FileOutputStream(tempFile).use { output ->
                input.copyTo(output)
            }
        }
        return tempFile
    }

    private fun parseUploadResponse(json: String): List<Attachment> {
        val response = JSONObject(json)
        val files = response.getJSONArray("files")

        return (0 until files.length()).map { i ->
            val file = files.getJSONObject(i)
            Attachment(
                name = file.getString("name"),
                path = file.getString("path"),
                size = file.optLong("size", 0)
            )
        }
    }

    private data class FileInfo(
        val name: String,
        val size: Long,
        val mimeType: String?
    )
}
