const {
	addSuperBoardImportToMainApplication,
	addSuperBoardConfigure,
	addSuperBoardImportToMainActivity,
	addSuperBoardIntentImport,
	addSuperBoardOnStart,
	addSuperBoardOnNewIntent,
	addSuperBoardAppDependency,
} = require("../../../../../sdks/react-native/plugin/withSuperBoardAndroid");
const nativeContract = require("../../../../../sdks/react-native/plugin/native-contract.json");

const ANDROID_COORDINATE = `${nativeContract.android.packageName}:${nativeContract.android.version}`;
const ANDROID_DEPENDENCY = `implementation '${ANDROID_COORDINATE}'`;
const ANDROID_COORDINATE_PATTERN = new RegExp(
	ANDROID_COORDINATE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
	"g",
);

const SAMPLE_MAIN_APPLICATION = `package com.myapp

import android.app.Application
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.defaults.DefaultReactHost.getDefaultReactHost
import com.facebook.soloader.SoLoader

class MainApplication : Application(), ReactApplication {

  override val reactHost: ReactHost
    get() = getDefaultReactHost(applicationContext, reactNativeHost)

  override fun onCreate() {
    super.onCreate()
    SoLoader.init(this, false)
  }
}`;

const SAMPLE_MAIN_ACTIVITY = `package com.myapp

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  override fun getMainComponentName(): String = "MyApp"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)
}`;

const SAMPLE_APP_BUILD_GRADLE = `android {
  namespace "com.example"
}

dependencies {
  implementation "com.facebook.react:react-android"
}`;

describe("withSuperBoardAndroid - app dependency", () => {
	it("injects the released Android SDK coordinate with the new marker", () => {
		const result = addSuperBoardAppDependency(SAMPLE_APP_BUILD_GRADLE);
		expect(result).toContain(ANDROID_DEPENDENCY);
		expect(result).toContain("// @mbzadev/superboard-react-native-sdk:dep");
	});

	it("migrates the legacy marker and retired coordinate", () => {
		const legacy = SAMPLE_APP_BUILD_GRADLE.replace(
			'implementation "com.facebook.react:react-android"',
			"implementation 'io.superboard:SuperBoard:1.1.1' // @mbzadev/superboard-react-native:dep",
		);
		const result = addSuperBoardAppDependency(legacy);
		expect(result).toContain(`${ANDROID_DEPENDENCY} // @mbzadev/superboard-react-native-sdk:dep`);
		expect(result).not.toContain("io.superboard:SuperBoard:1.1.1");
		expect(addSuperBoardAppDependency(result)).toBe(result);
	});

	it("migrates the retired lowercase coordinate without a marker", () => {
		const legacy = SAMPLE_APP_BUILD_GRADLE.replace(
			'implementation "com.facebook.react:react-android"',
			'implementation("io.superboard:superboard-android:1.0.0")',
		);
		const result = addSuperBoardAppDependency(legacy);
		expect(result).toContain(ANDROID_DEPENDENCY);
		expect(result).not.toContain("io.superboard:superboard-android:1.0.0");
	});

	it("collapses duplicate legacy and current dependencies", () => {
		const duplicate = SAMPLE_APP_BUILD_GRADLE.replace(
			'implementation "com.facebook.react:react-android"',
			`implementation 'io.superboard:SuperBoard:1.1.1'
  ${ANDROID_DEPENDENCY}`,
		);
		const result = addSuperBoardAppDependency(duplicate);
		expect((result.match(ANDROID_COORDINATE_PATTERN) || []).length).toBe(1);
		expect(result).not.toContain("io.superboard:SuperBoard:1.1.1");
	});

	it("is idempotent with the current marker", () => {
		const first = addSuperBoardAppDependency(SAMPLE_APP_BUILD_GRADLE);
		expect(addSuperBoardAppDependency(first)).toBe(first);
	});
});

describe("withSuperBoardAndroid - MainApplication transforms", () => {
	describe("addSuperBoardImportToMainApplication", () => {
		it("adds SuperBoard import after last import", () => {
			const result = addSuperBoardImportToMainApplication(SAMPLE_MAIN_APPLICATION);
			expect(result).toContain("import io.superboard.SuperBoard");
			const superboardIndex = result.indexOf("import io.superboard.SuperBoard");
			const soloaderIndex = result.indexOf("import com.facebook.soloader.SoLoader");
			expect(superboardIndex).toBeGreaterThan(soloaderIndex);
		});

		it("does not duplicate import", () => {
			const first = addSuperBoardImportToMainApplication(SAMPLE_MAIN_APPLICATION);
			const second = addSuperBoardImportToMainApplication(first);
			const count = (second.match(/import io\.superboard\.SuperBoard/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardConfigure", () => {
		it("adds SuperBoard.configure after super.onCreate()", () => {
			const result = addSuperBoardConfigure(SAMPLE_MAIN_APPLICATION, {
				apiKey: "test-key",
				useTestEnvironment: true,
			});
			expect(result).toContain('SuperBoard.configure(this, "test-key", useTestEnvironment = true)');
			const configIndex = result.indexOf("SuperBoard.configure");
			const superIndex = result.indexOf("super.onCreate()");
			expect(configIndex).toBeGreaterThan(superIndex);
		});

		it("uses false for production environment", () => {
			const result = addSuperBoardConfigure(SAMPLE_MAIN_APPLICATION, {
				apiKey: "prod-key",
				useTestEnvironment: false,
			});
			expect(result).toContain("useTestEnvironment = false");
		});

		it("adds baseURL when provided", () => {
			const result = addSuperBoardConfigure(SAMPLE_MAIN_APPLICATION, {
				apiKey: "key",
				useTestEnvironment: false,
				baseURL: "https://custom.example.com",
			});
			expect(result).toContain('baseURL = "https://custom.example.com"');
		});

		it("omits baseURL when not provided", () => {
			const result = addSuperBoardConfigure(SAMPLE_MAIN_APPLICATION, {
				apiKey: "key",
				useTestEnvironment: false,
				baseURL: null,
			});
			expect(result).not.toContain("baseURL");
		});

		it("does not duplicate configuration", () => {
			const first = addSuperBoardConfigure(SAMPLE_MAIN_APPLICATION, {
				apiKey: "key",
				useTestEnvironment: false,
			});
			const second = addSuperBoardConfigure(first, {
				apiKey: "key",
				useTestEnvironment: false,
			});
			const count = (second.match(/SuperBoard\.configure/g) || []).length;
			expect(count).toBe(1);
		});
	});
});

describe("withSuperBoardAndroid - MainActivity transforms", () => {
	describe("addSuperBoardImportToMainActivity", () => {
		it("adds SuperBoard import", () => {
			const result = addSuperBoardImportToMainActivity(SAMPLE_MAIN_ACTIVITY);
			expect(result).toContain("import io.superboard.SuperBoard");
		});

		it("does not duplicate import", () => {
			const first = addSuperBoardImportToMainActivity(SAMPLE_MAIN_ACTIVITY);
			const second = addSuperBoardImportToMainActivity(first);
			const count = (second.match(/import io\.superboard\.SuperBoard/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardIntentImport", () => {
		it("adds Intent import", () => {
			const result = addSuperBoardIntentImport(SAMPLE_MAIN_ACTIVITY);
			expect(result).toContain("import android.content.Intent");
		});

		it("does not duplicate import", () => {
			const first = addSuperBoardIntentImport(SAMPLE_MAIN_ACTIVITY);
			const second = addSuperBoardIntentImport(first);
			const count = (second.match(/import android\.content\.Intent/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardOnStart", () => {
		it("adds onStart override with SuperBoard.onStart", () => {
			const result = addSuperBoardOnStart(SAMPLE_MAIN_ACTIVITY);
			expect(result).toContain("override fun onStart()");
			expect(result).toContain("super.onStart()");
			expect(result).toContain("SuperBoard.onStart(launcherActivity = this)");
		});

		it("does not duplicate onStart", () => {
			const first = addSuperBoardOnStart(SAMPLE_MAIN_ACTIVITY);
			const second = addSuperBoardOnStart(first);
			const count = (second.match(/SuperBoard\.onStart/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("addSuperBoardOnNewIntent", () => {
		it("adds onNewIntent override with SuperBoard.onNewIntent", () => {
			const result = addSuperBoardOnNewIntent(SAMPLE_MAIN_ACTIVITY);
			expect(result).toContain("override fun onNewIntent(intent: Intent)");
			expect(result).toContain("super.onNewIntent(intent)");
			expect(result).toContain("SuperBoard.onNewIntent(intent, launcherActivity = this)");
		});

		it("does not duplicate onNewIntent", () => {
			const first = addSuperBoardOnNewIntent(SAMPLE_MAIN_ACTIVITY);
			const second = addSuperBoardOnNewIntent(first);
			const count = (second.match(/SuperBoard\.onNewIntent/g) || []).length;
			expect(count).toBe(1);
		});
	});

	describe("full transform pipeline", () => {
		it("produces valid MainActivity with all modifications", () => {
			let result = SAMPLE_MAIN_ACTIVITY;
			result = addSuperBoardImportToMainActivity(result);
			result = addSuperBoardIntentImport(result);
			result = addSuperBoardOnStart(result);
			result = addSuperBoardOnNewIntent(result);

			expect(result).toContain("import io.superboard.SuperBoard");
			expect(result).toContain("import android.content.Intent");
			expect(result).toContain("SuperBoard.onStart");
			expect(result).toContain("SuperBoard.onNewIntent");
		});

		it("is idempotent when run twice", () => {
			function applyAll(input) {
				let r = input;
				r = addSuperBoardImportToMainActivity(r);
				r = addSuperBoardIntentImport(r);
				r = addSuperBoardOnStart(r);
				r = addSuperBoardOnNewIntent(r);
				return r;
			}

			const first = applyAll(SAMPLE_MAIN_ACTIVITY);
			const second = applyAll(first);
			expect(first).toBe(second);
		});
	});
});
