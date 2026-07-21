export const sdkAndroidValue = `import io.opengrow.OpenGrow
class MainApplication : Application() {

  override fun onCreate() {
    super.onCreate()
    OpenGrow.configure(this, "_OPENGROW_API_KEY_", useTestEnvironment = false)
  }
}
`;

export const googleCloudScript = `chmod +x opengrow_android_gcloud_setup.sh
./opengrow_android_gcloud_setup.sh`;

export const sdkLauncherActivityValue = `import io.opengrow.OpenGrow
class MainActivity : ComponentActivity() {
  override fun onStart() {
    super.onStart()
    OpenGrow.onStart()
  }
    override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)

    OpenGrow.onNewIntent(intent)
  }
}
`;
export const sdkHandleDeepLinksValue = `// Listen for open from link events using listeners

OpenGrow.setOnDeeplinkReceivedListener(this) {
  link, payload ->
  val message = "Got link from listener: $link payload: $payload"
  Log.d("OpenGrow", message)
}

// OR

//Listen for open from link events using kotlin coroutines

OpenGrow.Companion:: openedLinkDetails.flow.collect {
  deeplinkDetails ->
  val message = "Got link from flow: \${deeplinkDetails?.link} payload: 
  \${ deeplinkDetails?.data } "
  Log.d("OpenGrow", message)
}
`;

export const sdkReactNativeAppValue = `// Once configured, you can utilize the various functionalities provided by OpenGrow.
import OpenGrow from '@mbzadev/opengrow-react-native';

// You can receive deep link events by registering a listener. Here's how you can implement it:
const listener = OpenGrow.onDeeplinkReceived((data) => {
});

// When you don't want to receive events anymore
listener.remove(); // Stop receiving events


`;
