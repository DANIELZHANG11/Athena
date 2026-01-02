import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.athena.reader',
  appName: 'Athena Reader',
  webDir: 'dist',
  server: {
    // ========================================================
    // 【生产模式】使用本地打包的 dist 文件
    // 这种模式更稳定，不需要配置 ADB reverse
    // 
    // 【开发模式 - 热加载】如需启用，取消下面注释并运行 ADB 命令：
    //   adb reverse tcp:48000 tcp:48000
    //   adb reverse tcp:48173 tcp:48173
    //   url: 'http://localhost:48173',
    // ========================================================
    cleartext: true,  // 允许 HTTP 明文请求到后端
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
  android: {
    webContentsDebuggingEnabled: true,
  },
};

export default config;
