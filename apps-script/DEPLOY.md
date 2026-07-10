# Google Apps Script 意见箱部署

网站端已经接好 Apps Script 提交逻辑。首次部署只需要创建脚本、授权发信并填写部署地址。

## 1. 创建 Apps Script 项目

1. 登录用于发送意见邮件的 Google 账号。
2. 打开 <https://script.google.com>，点击“新建项目”。
3. 将项目命名为“大李敖全集意见箱”。
4. 打开编辑器中的 `Code.gs`，删除原内容。
5. 将本目录下 `Code.gs` 的全部内容粘贴进去，点击“保存”。

收件地址已经设为 `zzy951642853@gmail.com`。如需更换，请修改脚本顶部的 `RECIPIENT`。

## 2. 部署成 Web App

1. 点击右上角“部署” -> “新部署”。
2. 点击“选择类型”旁的齿轮，选择“Web 应用”。
3. “执行身份”选择“我”。
4. “谁有权访问”选择“任何人”。
5. 点击“部署”，按提示授权脚本发送邮件。
6. 复制部署后显示的 Web App URL。正式地址应以 `/exec` 结尾，不要使用 `/dev` 地址。

首次授权如果出现“Google 尚未验证此应用”，这是自己创建的私人脚本，可点击“高级”并继续进入自己的项目，然后允许发送邮件权限。

## 3. 将部署地址填入网站

打开 `theme/feedback-config.js`，将 Web App URL 填入 `endpoint`：

```js
window.LEEAO_FEEDBACK_CONFIG = {
  endpoint: "https://script.google.com/macros/s/你的部署编号/exec",
  maxAttachmentBytes: 5 * 1024 * 1024,
  responseTimeoutMs: 30000
};
```

打开 Web App URL 后，如果页面显示“大李敖全集意见箱服务已启动”，说明后端已经部署成功。

## 4. 测试

1. 构建或发布网站。
2. 从网站打开“意见箱”，先提交一条不带图片的测试意见。
3. 再提交一张小于 5MB 的 PNG 或 JPG。
4. 确认 `zzy951642853@gmail.com` 收到两封邮件，并确认第二封带有图片附件。
5. 如果没有看到邮件，请同时检查 Gmail 的“垃圾邮件”和 Apps Script 左侧的“执行记录”。

## 后续更新脚本

修改 `Code.gs` 后，打开“部署” -> “管理部署”，点击铅笔图标，版本选择“新版本”后再次部署。原 `/exec` 地址会保持不变。

脚本内置每小时 20 封、每天 80 封的保护上限，并会过滤隐藏字段、过快提交和重复提交。普通 Gmail 的实际每日额度也会由 Apps Script 自动检查。
