# 发布前检查

- 根目录应是README.md、package.json、server.mjs与android/public/src/tests/examples/scripts/docs等工程目录；不要把包含其他版本的整个上层工作区上传。
- 自有代码已按作者最新选择采用MIT，见根LICENSE；README、package.json与锁文件已同步。保留第三方原许可与归属说明，不把本项目MIT声明覆盖到第三方组件或音乐内容。
- 保留android/NOTICE.txt、NETEASE-LICENSE.txt、APACHE-LICENSE.txt与Gradle Wrapper的归属说明；新增依赖单独核对。
- 不加入Cookie、令牌、签名密钥、local.properties、.env、个人备份、歌曲／歌词或未经许可的GIF素材。不要用含个人信息的截图做展示。
- 运行npm ci、npm test、npm run check与Android测试／Lint／构建；完成设备验收，再决定是否分发APK。debug预览不等于正式发布包。
- 正式签名密钥离线保管；更新同一个applicationId需要相同签名。不要把构建私钥上传仓库或Release。
- 平台适配仍需遵守相应授权、版权与服务规则。仓库公开、测试通过或附有免责声明，都不是自动完成合法性／合规审查的证明。
- APK、源码ZIP与摘要适合单独作为Release附件，不要混进源代码目录；实际发布由仓库作者确认。

仓库上传与Release发布分别由维护者确认；源码公开不代表已发布安装包。
