import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.athena.reader',
  appName: 'Athena Reader',
  webDir: 'dist',
  server: {
    // 开发模式：连接到 Vite 开发服务器实现热加载
    // 生产模式：注释掉 url 和 cleartext，使用打包后的 dist
    url: 'http://192.168.0.122:48173',
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
  },
};

export default config;
