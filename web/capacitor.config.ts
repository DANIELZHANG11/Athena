import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.athena.reader',
  appName: 'Athena Reader',
  webDir: 'dist',
  server: {
    // ========================================================
    // 移动端开发配置（启动 Android/iOS 模拟器时取消注释）：
    // url: 'http://你的本机IP地址:48173',  // 例如: 192.168.0.xxx
    // cleartext: true,
    // ========================================================
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
