plugins {
    id("com.android.application")
    id("kotlin-android")
    id("dev.flutter.flutter-gradle-plugin")
}

android {
    namespace = "io.superboard.example"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_11.toString()
    }

    defaultConfig {
        applicationId = "io.superboard.example"
        minSdk = flutter.minSdkVersion
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
        manifestPlaceholders["SUPERBOARD_API_KEY"] =
            System.getenv("SUPERBOARD_API_KEY")
                ?: System.getenv("SUPERBOARD_API_KEY")
                ?: ""
        manifestPlaceholders["SUPERBOARD_BASE_URL"] =
            System.getenv("SUPERBOARD_BASE_URL")
                ?: System.getenv("SUPERBOARD_BASE_URL")
                ?: ""
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
