import { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'com.app.lingmo',
  appName: '__APP_NAME__',
  webDir: 'www',
  plugins: {
    Filesystem: {}
  },
  android: {
    allowMixedContent: true
  }
};
export default config;
