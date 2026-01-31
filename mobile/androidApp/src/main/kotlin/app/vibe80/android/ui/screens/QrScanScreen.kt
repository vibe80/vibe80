package app.vibe80.android.ui.screens

import android.Manifest
import android.annotation.SuppressLint
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import app.vibe80.android.viewmodel.SessionViewModel
import com.google.mlkit.vision.barcode.Barcode
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.common.InputImage
import org.koin.androidx.compose.koinViewModel
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun QrScanScreen(
    onHandoffComplete: (String) -> Unit,
    onBack: () -> Unit,
    viewModel: SessionViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var hasPermission by remember { mutableStateOf(false) }
    val scanGate = remember { AtomicBoolean(true) }
    var scanEnabled by remember { mutableStateOf(true) }

    val updateScanEnabled: (Boolean) -> Unit = { value ->
        scanEnabled = value
        scanGate.set(value)
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasPermission = granted
    }

    LaunchedEffect(Unit) {
        permissionLauncher.launch(Manifest.permission.CAMERA)
    }

    LaunchedEffect(uiState.handoffError) {
        if (!uiState.handoffError.isNullOrBlank()) {
            updateScanEnabled(true)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Scanner un QR code") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Retour")
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            when {
                !hasPermission -> {
                    Column(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(24.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterVertically),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Icon(Icons.Default.CameraAlt, contentDescription = null)
                        Text(
                            text = "L'accès a la caméra est requis pour scanner le QR code.",
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Button(onClick = { permissionLauncher.launch(Manifest.permission.CAMERA) }) {
                            Text("Autoriser la caméra")
                        }
                    }
                }

                else -> {
                    QrScannerPreview(
                        modifier = Modifier.fillMaxSize(),
                        enabled = scanEnabled,
                        onQrScanned = { payload ->
                            if (scanGate.compareAndSet(true, false)) {
                                updateScanEnabled(false)
                                viewModel.consumeHandoffPayload(payload) { sessionId ->
                                    onHandoffComplete(sessionId)
                                }
                            }
                        }
                    )
                    if (uiState.handoffBusy) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center
                        ) {
                            CircularProgressIndicator()
                        }
                    }
                    if (!uiState.handoffError.isNullOrBlank()) {
                        Column(
                            modifier = Modifier
                                .align(Alignment.BottomCenter)
                                .padding(24.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp),
                            horizontalAlignment = Alignment.CenterHorizontally
                        ) {
                            Text(
                                text = uiState.handoffError ?: "",
                                color = MaterialTheme.colorScheme.error
                            )
                            Button(
                                onClick = {
                                    viewModel.clearHandoffError()
                                    updateScanEnabled(true)
                                }
                            ) {
                                Text("Recommencer")
                            }
                        }
                    }
                }
            }
        }
    }
}

@SuppressLint("UnsafeOptInUsageError")
@Composable
private fun QrScannerPreview(
    modifier: Modifier,
    enabled: Boolean,
    onQrScanned: (String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    val previewView = remember { PreviewView(context) }
    val enabledState = rememberUpdatedState(enabled)
    val onQrScannedState = rememberUpdatedState(onQrScanned)

    DisposableEffect(lifecycleOwner) {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(context)
        val executor = Executors.newSingleThreadExecutor()
        val scanner = BarcodeScanning.getClient(
            BarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build()
        )
        var cameraProvider: ProcessCameraProvider? = null

        val listener = Runnable {
            cameraProvider = cameraProviderFuture.get()
            val preview = Preview.Builder().build().apply {
                setSurfaceProvider(previewView.surfaceProvider)
            }
            val analysis = ImageAnalysis.Builder()
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            analysis.setAnalyzer(executor) { imageProxy ->
                if (!enabledState.value) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                val mediaImage = imageProxy.image
                if (mediaImage == null) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                val image = InputImage.fromMediaImage(
                    mediaImage,
                    imageProxy.imageInfo.rotationDegrees
                )
                scanner.process(image)
                    .addOnSuccessListener { barcodes ->
                        val rawValue = barcodes.firstOrNull { it.rawValue != null }?.rawValue
                        if (!rawValue.isNullOrBlank() && enabledState.value) {
                            onQrScannedState.value(rawValue)
                        }
                    }
                    .addOnCompleteListener {
                        imageProxy.close()
                    }
            }

            cameraProvider?.unbindAll()
            cameraProvider?.bindToLifecycle(
                lifecycleOwner,
                CameraSelector.DEFAULT_BACK_CAMERA,
                preview,
                analysis
            )
        }

        cameraProviderFuture.addListener(listener, context.mainExecutor)

        onDispose {
            try {
                scanner.close()
            } catch (_: Exception) {
                // Ignore close errors
            }
            cameraProvider?.unbindAll()
            executor.shutdown()
        }
    }

    AndroidView(
        factory = { previewView },
        modifier = modifier
    )
}
