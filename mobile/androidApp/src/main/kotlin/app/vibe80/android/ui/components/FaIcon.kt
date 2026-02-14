package app.vibe80.android.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.material3.Text
import app.vibe80.android.ui.theme.FontAwesomeRegular
import app.vibe80.android.ui.theme.FontAwesomeSolid

object FaIcons {
    const val Plus = "\uf067"
    const val Terminal = "\uf120"
    const val CodeBranch = "\uf126"
    const val Message = "\uf27a"
    const val ArrowDown = "\uf063"
    const val ArrowUp = "\uf062"
    const val Send = "\uf1d8"
    const val Camera = "\uf030"
    const val Image = "\uf03e"
    const val File = "\uf15b"
    const val Model = "\uf2db"
    const val Close = "\uf00d"
    const val Compare = "\uf362"
    const val Bug = "\uf188"
    const val Refresh = "\uf2f1"
    const val Logout = "\uf2f5"
    const val ArrowLeft = "\uf060"
    const val Eye = "\uf06e"
    const val EyeSlash = "\uf070"
    const val FolderOpen = "\uf07c"
    const val Check = "\uf00c"
    const val CheckCircle = "\uf058"
    const val XCircle = "\uf057"
    const val EllipsisVertical = "\uf142"
    const val Code = "\uf121"
    const val ChevronUp = "\uf077"
    const val ChevronDown = "\uf078"
    const val Edit = "\uf044"
    const val Delete = "\uf1f8"
    const val Warning = "\uf071"
    const val Api = "\uf233"
    const val WebSocket = "\uf6ff"
    const val App = "\uf095"
}

enum class FaStyle { Solid, Regular }

@Composable
fun FaIcon(
    icon: String,
    contentDescription: String? = null,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp,
    tint: Color = LocalContentColor.current,
    style: FaStyle = FaStyle.Solid
) {
    val fontFamily: FontFamily = if (style == FaStyle.Regular) FontAwesomeRegular else FontAwesomeSolid
    val fontSize = with(LocalDensity.current) { size.toSp() }
    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Text(
            text = icon,
            style = TextStyle(
                color = tint,
                fontFamily = fontFamily,
                fontSize = fontSize,
                textAlign = TextAlign.Center
            ),
            modifier = Modifier.fillMaxSize()
        )
    }
}
