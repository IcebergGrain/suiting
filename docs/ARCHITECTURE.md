# 架构与目录

| 路径 | 职责 |
| --- | --- |
| public/ | 本地界面、播放器与扩展设置；浏览器IndexedDB音频副本 |
| src/ | 可移植随机核心、歌单合并、分类、歌词、扩展合同与数据源权限 |
| android/ | WebViewAssetLoader、只读文档授权、原生网络、Media3服务与桌面歌词 |
| server.mjs | 本机Web开发服务和可选平台接口；不接收本地音频上传 |
| scripts/ | Web启动、Android资源准备与构建 |
| tests/ | JavaScript回归与合成协议数据 |
| examples/ | 声明式预设／重排JSON与未默认注册的可信源码接口示例 |

## 核心流程

选择本地音频→导入安全元数据→选择范围与随机规则→筛选与配额抽样→受限扩展重排→生成独立候选→手动播放交接后替换当前列表。生成不调用播放器；createListeningSession 保存当前列表元数据。真实听满15秒才记录曝光，拖进度不算；曝光降低短期重复机会，不冒充主动喜爱。
每个维度内多选为并集，维度之间共同限制。已知冲突不当作未知；宽松氛围补位不能突破硬范围、语言、冷却、黑名单或近期端点。

## 双运行环境

Web本地音频副本保存在浏览器IndexedDB，以blob地址播放；本机Node只在网易云开关开启时为授权平台调用服务。Android只保存主动选择文档的content授权和私有索引，Media3直接读取文件；URI与账号凭据不暴露给WebView或JSON备份。
本地和网易云source通过extension-host调度，原生与Node另有能力门禁。关闭平台清除授权并停止平台路径的新调用，不能撤回已经发出的请求。

## 能力边界

固定包名io.suiting.music.publicapp，版本0.1.4-public／code5。安装名称随听。保留绿色与浅／深色主题；共享UI不是纯原生Compose，也不是网易云官方插件。
JSON扩展是数据，源码扩展是需审查的可信代码。metadata／lyrics／presentation等kind提供合同，不代表任意运行时安装器已经实现。可扩展不等于允许绕过安全与随机不变量。

## 后续维护要点

- 新增浏览器共享模块必须同时登记 server.mjs 的静态白名单和 scripts/prepare-android.mjs 的 APK 资源清单；tests/public-update.test.mjs 会验证 Web 模块引用完整性。
- src/listening-session.mjs 只保存当前列表的安全元数据，不保存本地文档 URI、音频地址或凭据。生成候选不得调用播放器；日推、收藏和曲库的明确播放也走该交接层。
- src/shuffle.mjs 的负向分类是硬限制。近期 100 首先按原范围排序取池，再排除，不得提前过滤整库而把更早歌曲晋升为近期。未知分类的取舍由用户明确开关。
- src/library.mjs 与原生 ArtistRules 共同维护歌手 ID／完整署名语义。公开版须始终保留 local- 命名空间，不能照搬仅允许数字歌曲 ID 的私用代码。
- NotificationFavorites 的红心只面向已启用网易云的官方数字 ID；NotificationControlPolicy 防止本地曲目或关闭插件绕过门禁。通知歌词不替用户开启插件或授予系统权限，不恢复常驻浮窗按钮。
- 0.1.4 的 `src/likes-journal.mjs`／原生 `LocalLikes` 将按账号暂存的喜欢意图与远端观察快照分开。安卓通知和 WebView 共用应用私有日志；网页使用 `suiting.public.likes.v1`。仅显式同步写入官方，读回才清除对应待办；较新操作、失败与账户切换不可被旧回包覆盖。本地歌曲 ID 永不进入官方喜欢日志，通用歌单 JSON 备份不迁移喜欢日志。
- `PlaybackRules.restartAtEnd` 只处理有播放意图的自然末尾续播，保留暂停、停止、错误和候选交接语义；本地 content／blob 与网易云来源走原有各自路径，不因移植私用修复而丢失本地音频支持。
- 彩蛋继续默认关闭、原创素材兜底、用户临时自选。不要将个人版 GIF、商用录音、真实歌单备份或测试音频打入公开包。
