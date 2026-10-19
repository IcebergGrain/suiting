# 第三方组件

本目录不包含node_modules、Android依赖缓存或音乐素材。依赖由固定锁文件／Gradle坐标解析，组件仍按各自许可证提供；随听自有代码采用根目录MIT许可证；以下说明不改变第三方各自的许可。

- @neteasecloudmusicapienhanced/api 4.41.1：平台协议参考／Node适配依赖，MIT文本保留在android/NETEASE-LICENSE.txt。
- qrcode 1.5.4：Node二维码生成，依赖许可证随npm分发提供。
- jsdom 24.1.3：仅开发测试，依赖许可证随npm分发提供。
- AndroidX WebKit1.12.1、Media3 ExoPlayer／Session1.5.1及运行时组件，ZXing Core3.5.3：见android/NOTICE.txt与APACHE-LICENSE.txt。
- Gradle Wrapper：构建引导文件及校验设置保留在android/gradle，依赖分发许可与运行环境自行核对。

APK的assets/licenses保留既有第三方文本。节点依赖完整树见package-lock.json，原生依赖见android/app/build.gradle；后续打包或新增依赖需要复核许可证，不保证此短表覆盖未来变化。

随听是独立应用，不隶属网易云或其他音乐平台。账号权限、内容目录及播放权由平台决定；本地文件的使用权由用户自行确认。
