# Add project specific ProGuard rules here.

# Keep Ktor classes
-keep class io.ktor.** { *; }
-keepclassmembers class io.ktor.** { *; }

# Keep Kotlinx Serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keepclassmembers class kotlinx.serialization.json.** {
    *** Companion;
}
-keepclasseswithmembers class kotlinx.serialization.json.** {
    kotlinx.serialization.KSerializer serializer(...);
}
-keep,includedescriptorclasses class app.m5chat.**$$serializer { *; }
-keepclassmembers class app.m5chat.** {
    *** Companion;
}
-keepclasseswithmembers class app.m5chat.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Keep shared module models
-keep class app.m5chat.shared.models.** { *; }
