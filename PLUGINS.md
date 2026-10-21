# 随听插件协议 v1

原则：可控随机、范围／冷却／黑名单校验、本地文件授权和平台身份校验是宿主不变量；扩展不能绕过。其余能力按插件边界分层，关闭后不调度，不丢分类或历史。没有“给任意代码全部权限”的选项。

## 已运行的开关
- netease：source，默认false。本人确认后调用第一方授权接口；原生与Node都作门禁。关闭断开账号、移除平台曲目，不停止仍在播放的本地曲目，不删快照。
- metadata：本地文件元数据，默认true，仅Android系统容器读取；不等于AI听音分析。关闭影响之后的导入，不抹去手工分类。
- lyrics：歌词显示／读取，默认true。读取本机用户LRC或已启用的歌曲平台。
- desktopLyrics：Android浮层表现，默认false，另需系统权限；关闭立即隐藏。
- easterEggs：搜索彩蛋，默认false，用户在「我的 → 功能插件与 DIY」自行开关。原创动效与小调不联网、不改系统音量；第三方素材只允许用户临时自选，不打入公开包。
- JSON queue-order：只重排本次已选集合；默认false。preset：手工应用一次参数，不持续运行。

## 数据型插件：无需改源码
导入例子 examples/ 中已有API1预设和重排JSON。normalizePlugin只接固定字段和规则；预设可含moods、genres、languages、excludeMoods、excludeGenres、excludeLanguages、excludeUnclassified、数量、冷却、近期与参考强度，但不可设置账号、来源URI、任意URL或脚本。源歌曲与完整元数据来自宿主，validateQueueOrder验证ID集合与去重；扩展不能新增外部歌、复活黑名单或改元数据。

## 源码型插件：开发者扩展点
src/extension-host.mjs 提供 createExtensionHost，manifest含id、name、kind与methods；kind可为source、metadata、lyrics、queue-order或presentation。方法必须显式注册，调用前检查isEnabled。应用的suiting.local／suiting.netease两个source已经通过host调度；其他kind是版本化接口约定，不等于已实现任意运行时插件安装。

public/plugins/registry.mjs 的queueProviders保留可信队列适配入口：context只给已选ID／歌名／歌手与AbortSignal，不给音频、账号或文档URI；返回同一集合的ID顺序，超时或错误保留原队列。network、endpoint、version进入显式开启确认。源码插件可访问其进程能力，**不是安全沙箱**，宿主不能仅凭声明保证第三方源码不联网。

新增source需同时实现注册、来源标识、UI、原生白名单／服务端门禁、权限撤销、错误保留与测试；不能只新增manifest就声称支持。metadata／lyrics等新适配同理需接入对应生命周期后再开放。未来AI适配先列接收方与字段、默认关闭、显式确认，不能把“本地音乐”变成偷偷上传。

## 私密数据和发布
不把Cookie、key、文档URI、音频或私人歌单打进扩展示例。第三方源码审查、网络权限及平台条款不能被插件机制免除。不支持加密音频解锁、付费绕过或同名跨平台匹配。插件许可证与素材权利要独立核对；本轮未自动发布任何项目。
