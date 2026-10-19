# Android工程

随听公开预览0.1.1，applicationId为io.suiting.music.publicapp，versionCode2，最低Android8.0，compile/targetSdk35。Java namespace为io.suiting.music，不等于安装包身份。

构建步骤与当前验收边界见[开发说明](../docs/DEVELOPMENT.md)；账号和系统权限见[隐私说明](../PRIVACY.md)，扩展见[PLUGINS](../PLUGINS.md)。

音频采用系统文档选择器的只读授权，原生私有索引保存content URI；Media3 DefaultDataSource读取获授权文件。不扫描全盘，不把URI交给WebView，不修改原音频；提供方撤权／移动文件后需重新选择。

界面从WebViewAssetLoader固定HTTPS原点加载，原生RPC校验来源与方法白名单。网易云默认关，由原生及共享层独立检查；不提供任意URL请求。可选桌面歌词需要系统悬浮窗权限，拒绝不影响核心播放器。

本仓库不提供签名私钥。scripts/build-android.ps1在指定工具目录创建本机预览密钥；新构建与既有APK可能不同签名，不能盲目卸载旧包，先保管备份。当前不是商店production签名构建，没有宣称通过设备矩阵。
