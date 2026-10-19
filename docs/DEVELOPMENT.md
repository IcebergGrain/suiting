# 开发与构建

## 浏览器

Node.js22+，在仓库根目录运行npm ci、npm test、npm run check、npm start。默认仅监听127.0.0.1:4392；不要把开发服务暴露到公网。Windows也可运行启动随听.cmd。手机同网试用.cmd会绑定可信局域网地址，不修改防火墙；普通HTTP局域网下浏览器安全上下文功能可能受限，Android本地导入应使用APK验证。

## Android

Android8.0+，JDK17、Android SDK Platform35、Build Tools35.0.0、Gradle8.9。先阅读并接受SDK条款，再自行安装官方工具。无须电脑或Node服务常驻即可运行APK。

```powershell
$env:JAVA_HOME='你的JDK17目录'
$env:ANDROID_SDK_ROOT='你的Android SDK目录'
npm ci
npm test
npm run check
powershell -ExecutionPolicy Bypass -File .\scripts\build-android.ps1 -ToolsDirectory '你的构建工具与缓存目录'
```

脚本依次执行testDebugUnitTest、lintDebug、assembleDebug，构建前从当前public/src准备界面模块并检查引用。输出android/app/build/outputs/apk/debug/app-debug.apk。
工具目录中优先使用gradle-8.9，否则使用仓库Wrapper，首次解析依赖需要网络。预览密钥在工具目录生成，不在仓库中；不同机器默认产生不同密钥，不能互相覆盖安装。正式分发需另行安全管理发布签名，不把密码、私钥或机器路径提交到仓库。

## 验证范围

现版197项JavaScript、37项JVM通过，Android构建成功、Lint0错误与2项既有提示。Web验证使用合成静音音频与LRC，覆盖导入、刷新恢复、进度、歌词、黑名单与队列替换。
尚需Android设备验证多选与跨重启文档授权、文件移走／撤权、各编码解码、后台／锁屏、悬浮窗位置与点击穿透，以及真实账号登录／版权音源。容器扩展名受支持不保证所有设备解码成功。
