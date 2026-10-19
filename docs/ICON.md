# 图标资源

0.1.1公开版采用自制森林绿黑胶唱片与播放标记；个人版／实验室版的原图标不改。公开版中心有播放三角，不使用文件／便签造型。

- public/icon.svg：Web图标与导航品牌，64×64坐标，自包含路径，没有外链或字体。
- android/app/src/main/res/drawable/ic_launcher_foreground.xml：108dp自适应前景，和SVG共享同一组路径及颜色，仅增加居中变换。
- drawable/ic_launcher_monochrome.xml：支持主题图标的单色透明层，中心播放标记用镂空，不把绿色背景烘焙进前景。
- mipmap-anydpi/ic_launcher.xml：组合背景、前景、单色层，最低系统26，无须额外旧系统资源副本。Manifest的icon与roundIcon都引用它。

图形中心为54dp，最大半径28.125dp，位于108dp画布中央66dp安全区；实际圆形／圆角遮罩和主题色由启动器决定。保留前景透明区域，不给Android图层预裁圆角。
tests/icon.test.mjs检查SVG独立性、原生路径／调色一致、adaptive与单色资源引用和安全区。修改图标时同时维护两端并跑测试／Android构建，不能只换网页文件。

浏览器矢量及遮罩示意不等于设备截图。当前没有连接Android设备，厂商主题、图标缓存更新与实际启动器仍需用户验证。图标属于本项目自制资源，按根MIT许可分发；音乐平台商标及其他第三方内容不在此授权内。
