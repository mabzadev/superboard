const {
  addOpenGrowImportToMainApplication,
  addOpenGrowConfigure,
  addOpenGrowImportToMainActivity,
  addOpenGrowIntentImport,
  addOpenGrowOnStart,
  addOpenGrowOnNewIntent,
} = require('../withOpenGrowAndroid');

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

describe('withOpenGrowAndroid - MainApplication transforms', () => {
  describe('addOpenGrowImportToMainApplication', () => {
    it('adds OpenGrow import after last import', () => {
      const result = addOpenGrowImportToMainApplication(SAMPLE_MAIN_APPLICATION);
      expect(result).toContain('import io.opengrow.OpenGrow');
      const opengrowIndex = result.indexOf('import io.opengrow.OpenGrow');
      const soloaderIndex = result.indexOf(
        'import com.facebook.soloader.SoLoader'
      );
      expect(opengrowIndex).toBeGreaterThan(soloaderIndex);
    });

    it('does not duplicate import', () => {
      const first = addOpenGrowImportToMainApplication(SAMPLE_MAIN_APPLICATION);
      const second = addOpenGrowImportToMainApplication(first);
      const count = (second.match(/import io\.opengrow\.OpenGrow/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowConfigure', () => {
    it('adds OpenGrow.configure after super.onCreate()', () => {
      const result = addOpenGrowConfigure(SAMPLE_MAIN_APPLICATION, {
        apiKey: 'test-key',
        useTestEnvironment: true,
      });
      expect(result).toContain(
        'OpenGrow.configure(this, "test-key", useTestEnvironment = true)'
      );
      const configIndex = result.indexOf('OpenGrow.configure');
      const superIndex = result.indexOf('super.onCreate()');
      expect(configIndex).toBeGreaterThan(superIndex);
    });

    it('uses false for production environment', () => {
      const result = addOpenGrowConfigure(SAMPLE_MAIN_APPLICATION, {
        apiKey: 'prod-key',
        useTestEnvironment: false,
      });
      expect(result).toContain('useTestEnvironment = false');
    });

    it('adds baseURL when provided', () => {
      const result = addOpenGrowConfigure(SAMPLE_MAIN_APPLICATION, {
        apiKey: 'key',
        useTestEnvironment: false,
        baseURL: 'https://custom.example.com',
      });
      expect(result).toContain('baseURL = "https://custom.example.com"');
    });

    it('omits baseURL when not provided', () => {
      const result = addOpenGrowConfigure(SAMPLE_MAIN_APPLICATION, {
        apiKey: 'key',
        useTestEnvironment: false,
        baseURL: null,
      });
      expect(result).not.toContain('baseURL');
    });

    it('does not duplicate configuration', () => {
      const first = addOpenGrowConfigure(SAMPLE_MAIN_APPLICATION, {
        apiKey: 'key',
        useTestEnvironment: false,
      });
      const second = addOpenGrowConfigure(first, {
        apiKey: 'key',
        useTestEnvironment: false,
      });
      const count = (second.match(/OpenGrow\.configure/g) || []).length;
      expect(count).toBe(1);
    });
  });
});

describe('withOpenGrowAndroid - MainActivity transforms', () => {
  describe('addOpenGrowImportToMainActivity', () => {
    it('adds OpenGrow import', () => {
      const result = addOpenGrowImportToMainActivity(SAMPLE_MAIN_ACTIVITY);
      expect(result).toContain('import io.opengrow.OpenGrow');
    });

    it('does not duplicate import', () => {
      const first = addOpenGrowImportToMainActivity(SAMPLE_MAIN_ACTIVITY);
      const second = addOpenGrowImportToMainActivity(first);
      const count = (second.match(/import io\.opengrow\.OpenGrow/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowIntentImport', () => {
    it('adds Intent import', () => {
      const result = addOpenGrowIntentImport(SAMPLE_MAIN_ACTIVITY);
      expect(result).toContain('import android.content.Intent');
    });

    it('does not duplicate import', () => {
      const first = addOpenGrowIntentImport(SAMPLE_MAIN_ACTIVITY);
      const second = addOpenGrowIntentImport(first);
      const count = (second.match(/import android\.content\.Intent/g) || [])
        .length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowOnStart', () => {
    it('adds onStart override with OpenGrow.onStart', () => {
      const result = addOpenGrowOnStart(SAMPLE_MAIN_ACTIVITY);
      expect(result).toContain('override fun onStart()');
      expect(result).toContain('super.onStart()');
      expect(result).toContain('OpenGrow.onStart(launcherActivity = this)');
    });

    it('does not duplicate onStart', () => {
      const first = addOpenGrowOnStart(SAMPLE_MAIN_ACTIVITY);
      const second = addOpenGrowOnStart(first);
      const count = (second.match(/OpenGrow\.onStart/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe('addOpenGrowOnNewIntent', () => {
    it('adds onNewIntent override with OpenGrow.onNewIntent', () => {
      const result = addOpenGrowOnNewIntent(SAMPLE_MAIN_ACTIVITY);
      expect(result).toContain('override fun onNewIntent(intent: Intent)');
      expect(result).toContain('super.onNewIntent(intent)');
      expect(result).toContain(
        'OpenGrow.onNewIntent(intent, launcherActivity = this)'
      );
    });

    it('does not duplicate onNewIntent', () => {
      const first = addOpenGrowOnNewIntent(SAMPLE_MAIN_ACTIVITY);
      const second = addOpenGrowOnNewIntent(first);
      const count = (second.match(/OpenGrow\.onNewIntent/g) || []).length;
      expect(count).toBe(1);
    });
  });

  describe('full transform pipeline', () => {
    it('produces valid MainActivity with all modifications', () => {
      let result = SAMPLE_MAIN_ACTIVITY;
      result = addOpenGrowImportToMainActivity(result);
      result = addOpenGrowIntentImport(result);
      result = addOpenGrowOnStart(result);
      result = addOpenGrowOnNewIntent(result);

      expect(result).toContain('import io.opengrow.OpenGrow');
      expect(result).toContain('import android.content.Intent');
      expect(result).toContain('OpenGrow.onStart');
      expect(result).toContain('OpenGrow.onNewIntent');
    });

    it('is idempotent when run twice', () => {
      function applyAll(input) {
        let r = input;
        r = addOpenGrowImportToMainActivity(r);
        r = addOpenGrowIntentImport(r);
        r = addOpenGrowOnStart(r);
        r = addOpenGrowOnNewIntent(r);
        return r;
      }

      const first = applyAll(SAMPLE_MAIN_ACTIVITY);
      const second = applyAll(first);
      expect(first).toBe(second);
    });
  });
});
