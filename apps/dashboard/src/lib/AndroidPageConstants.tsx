export const sdkAndroidValue = `import io.grovs.Grovs
class MainApplication : Application() {

  override fun onCreate() {
    super.onCreate()
    Grovs.configure(this, "_GROVS_API_KEY_", useTestEnvironment = false)
  }
}
`;

export const googleCloudScript = `chmod +x grovs_android_gcloud_setup.sh
./grovs_android_gcloud_setup.sh`;

export const sdkLauncherActivityValue = `import io.grovs.Grovs
class MainActivity : ComponentActivity() {
  override fun onStart() {
    super.onStart()
    Grovs.onStart()
  }
    override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)

    Grovs.onNewIntent(intent)
  }
}
`;
export const sdkHandleDeepLinksValue = `// Listen for open from link events using listeners

Grovs.setOnDeeplinkReceivedListener(this) {
  link, payload ->
  val message = "Got link from listener: $link payload: $payload"
  Log.d("Grovs", message)
}

// OR

//Listen for open from link events using kotlin coroutines

Grovs.Companion:: openedLinkDetails.flow.collect {
  deeplinkDetails ->
  val message = "Got link from flow: \${deeplinkDetails?.link} payload: 
  \${ deeplinkDetails?.data } "
  Log.d("Grovs", message)
}
`;

export const sdkReactNativeAppValue = `// Once configured, you can utilize the various functionalities provided by Grovs.
import Grovs from 'react-native-grovs-wrapper';

// You can receive deep link events by registering a listener. Here's how you can implement it:
const listener = Grovs.onDeeplinkReceived((data) => {
});

// When you don't want to receive events anymore
listener.remove(); // Stop receiving events


`;
