var CONFIG = Object.freeze({
  RECIPIENT: "zzy951642853@gmail.com",
  MAX_ATTACHMENT_BYTES: 5 * 1024 * 1024,
  MAX_PER_HOUR: 20,
  MAX_PER_DAY: 80,
  MIN_FORM_TIME_MS: 2500,
  TIMEZONE: "Asia/Shanghai",
  ALLOWED_ORIGINS: [
    "https://books.leeao.net",
    "https://golgo11.github.io"
  ]
});

var RESPONSE_CHANNEL = "leeao-feedback-apps-script";

function doGet() {
  return HtmlService.createHtmlOutput(
    "<!doctype html><meta charset=\"utf-8\"><title>意见箱服务</title>" +
    "<p>大李敖全集意见箱服务已启动。</p>"
  );
}

function doPost(event) {
  var submissionId = "";
  var responseOrigin = "*";
  var reserved = false;

  try {
    var rawPayload = event && event.parameter && event.parameter.payload;
    if (!rawPayload) throw userError_("没有收到意见内容，请刷新页面后重试。");

    var payload = JSON.parse(rawPayload);
    submissionId = cleanSubmissionId_(payload.submissionId);
    responseOrigin = getResponseOrigin_(payload.pageOrigin);

    // Bots commonly fill hidden fields. Return success without consuming mail quota.
    if (String(payload.website || "").trim()) {
      return response_(submissionId, true, "意见已发送，谢谢！", responseOrigin);
    }

    var feedback = validatePayload_(payload, submissionId);
    var reservation = reserveSubmission_(submissionId);
    if (reservation === "duplicate") {
      return response_(submissionId, true, "这条意见已经发送，请勿重复提交。", responseOrigin);
    }
    reserved = true;

    sendFeedbackEmail_(feedback);
    completeSubmission_(submissionId);
    reserved = false;
    return response_(submissionId, true, "意见已发送，谢谢！", responseOrigin);
  } catch (error) {
    if (reserved && submissionId) releaseSubmission_(submissionId);
    var message = error && error.isUserError
      ? error.message
      : "邮件服务暂时不可用，请稍后重试。";
    console.error(error && error.stack ? error.stack : error);
    return response_(submissionId, false, message, responseOrigin);
  }
}

function validatePayload_(payload, submissionId) {
  if (!submissionId) throw userError_("提交编号无效，请刷新页面后重试。");
  if (!isAllowedOrigin_(payload.pageOrigin)) {
    throw userError_("当前网站地址未获准使用意见箱。");
  }

  var openedAt = Number(payload.openedAt);
  var submittedAt = Number(payload.submittedAt);
  var now = Date.now();
  if (!Number.isFinite(openedAt) || !Number.isFinite(submittedAt)) {
    throw userError_("提交时间无效，请刷新页面后重试。");
  }
  if (submittedAt - openedAt < CONFIG.MIN_FORM_TIME_MS) {
    throw userError_("填写速度过快，请检查内容后再次提交。");
  }
  if (Math.abs(now - submittedAt) > 60 * 60 * 1000) {
    throw userError_("表单已经过期，请刷新页面后重新填写。");
  }

  var feedbackType = requiredText_(payload.feedbackType, "意见类型", 40);
  var allowedTypes = ["内容纠错", "排版或跳转问题", "功能建议", "其他"];
  if (allowedTypes.indexOf(feedbackType) === -1) {
    throw userError_("意见类型无效。");
  }

  var email = optionalText_(payload.email, 160);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw userError_("回复邮箱格式不正确。");
  }

  return {
    submissionId: submissionId,
    feedbackType: feedbackType,
    name: optionalText_(payload.name, 80),
    email: email,
    message: requiredText_(payload.message, "意见内容", 5000),
    attachment: decodeAttachment_(payload.attachment)
  };
}

function decodeAttachment_(attachment) {
  if (!attachment) return null;

  var type = String(attachment.type || "").toLowerCase();
  var name = optionalText_(attachment.name, 180);
  if (["image/png", "image/jpeg"].indexOf(type) === -1) {
    throw userError_("图片格式只支持 PNG 或 JPG。");
  }
  if (!/\.(png|jpe?g)$/i.test(name)) {
    throw userError_("图片扩展名只支持 PNG 或 JPG。");
  }

  var encoded = String(attachment.data || "");
  if (!encoded || encoded.length > Math.ceil(CONFIG.MAX_ATTACHMENT_BYTES * 4 / 3) + 8) {
    throw userError_("图片内容无效或超过大小限制。");
  }

  var bytes;
  try {
    bytes = Utilities.base64Decode(encoded);
  } catch (error) {
    throw userError_("图片内容无法读取，请重新选择图片。");
  }
  if (bytes.length > CONFIG.MAX_ATTACHMENT_BYTES) {
    throw userError_("图片不能超过 5MB。");
  }

  var safeName = name.replace(/[\\/:*?\"<>|\r\n]/g, "_");
  return Utilities.newBlob(bytes, type, safeName || "feedback-image");
}

function reserveSubmission_(submissionId) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw userError_("提交人数较多，请稍后重试。");

  try {
    var cache = CacheService.getScriptCache();
    if (cache.get("done:" + submissionId)) return "duplicate";
    if (cache.get("pending:" + submissionId)) {
      throw userError_("这条意见正在发送，请勿重复提交。");
    }

    enforceRateLimit_();
    if (MailApp.getRemainingDailyQuota() < 1) {
      throw userError_("今天的邮件额度已经用完，请明天再试。");
    }
    cache.put("pending:" + submissionId, "1", 300);
    return "reserved";
  } finally {
    lock.releaseLock();
  }
}

function enforceRateLimit_() {
  var properties = PropertiesService.getScriptProperties();
  var now = new Date();
  var hourStamp = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd-HH");
  var dayStamp = Utilities.formatDate(now, CONFIG.TIMEZONE, "yyyy-MM-dd");
  var savedHourStamp = properties.getProperty("rateHourStamp");
  var savedDayStamp = properties.getProperty("rateDayStamp");
  var hourCount = savedHourStamp === hourStamp
    ? Number(properties.getProperty("rateHourCount") || 0)
    : 0;
  var dayCount = savedDayStamp === dayStamp
    ? Number(properties.getProperty("rateDayCount") || 0)
    : 0;

  if (hourCount >= CONFIG.MAX_PER_HOUR || dayCount >= CONFIG.MAX_PER_DAY) {
    throw userError_("意见箱当前提交较多，请稍后再试。");
  }

  properties.setProperties({
    rateHourStamp: hourStamp,
    rateHourCount: String(hourCount + 1),
    rateDayStamp: dayStamp,
    rateDayCount: String(dayCount + 1)
  });
}

function completeSubmission_(submissionId) {
  var cache = CacheService.getScriptCache();
  cache.remove("pending:" + submissionId);
  cache.put("done:" + submissionId, "1", 21600);
}

function releaseSubmission_(submissionId) {
  CacheService.getScriptCache().remove("pending:" + submissionId);
}

function sendFeedbackEmail_(feedback) {
  var lines = [
    "意见类型：" + feedback.feedbackType,
    "称呼：" + (feedback.name || "未填写"),
    "回复邮箱：" + (feedback.email || "未填写"),
    "提交编号：" + feedback.submissionId,
    "",
    "意见内容：",
    feedback.message
  ];

  var options = {
    to: CONFIG.RECIPIENT,
    subject: "[大李敖全集意见箱][" + feedback.feedbackType + "]",
    body: lines.join("\n"),
    htmlBody: buildHtmlBody_(feedback),
    name: "大李敖全集意见箱"
  };
  if (feedback.email) options.replyTo = feedback.email;
  if (feedback.attachment) options.attachments = [feedback.attachment];
  MailApp.sendEmail(options);
}

function buildHtmlBody_(feedback) {
  var rows = [
    ["意见类型", feedback.feedbackType],
    ["称呼", feedback.name || "未填写"],
    ["回复邮箱", feedback.email || "未填写"],
    ["提交编号", feedback.submissionId]
  ].map(function (row) {
    return "<tr><th style=\"padding:6px 10px;text-align:left;vertical-align:top;" +
      "border:1px solid #ddd;background:#f6f6f6\">" + escapeHtml_(row[0]) +
      "</th><td style=\"padding:6px 10px;border:1px solid #ddd\">" +
      escapeHtml_(row[1]) + "</td></tr>";
  }).join("");

  return "<h2>大李敖全集网站意见</h2>" +
    "<table style=\"border-collapse:collapse\">" + rows + "</table>" +
    "<h3>意见内容</h3><p style=\"white-space:pre-wrap\">" +
    escapeHtml_(feedback.message) + "</p>";
}

function response_(submissionId, ok, message, targetOrigin) {
  var payload = JSON.stringify({
    channel: RESPONSE_CHANNEL,
    submissionId: submissionId,
    ok: ok,
    message: message
  }).replace(/</g, "\\u003c");
  var origin = JSON.stringify(targetOrigin || "*");
  var html = "<!doctype html><meta charset=\"utf-8\"><script>" +
    "window.top.postMessage(" + payload + "," + origin + ");" +
    "<\/script>";
  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function isAllowedOrigin_(origin) {
  var value = String(origin || "");
  if (CONFIG.ALLOWED_ORIGINS.indexOf(value) !== -1) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value);
}

function getResponseOrigin_(origin) {
  return isAllowedOrigin_(origin) ? String(origin) : "*";
}

function cleanSubmissionId_(value) {
  var id = String(value || "").trim();
  return /^[a-zA-Z0-9-]{8,80}$/.test(id) ? id : "";
}

function requiredText_(value, label, maxLength) {
  var text = String(value || "").trim();
  if (!text) throw userError_(label + "不能为空。");
  if (text.length > maxLength) throw userError_(label + "内容过长。");
  return text;
}

function optionalText_(value, maxLength) {
  var text = String(value || "").trim();
  if (text.length > maxLength) throw userError_("提交内容过长。");
  return text;
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>\"']/g, function (character) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[character];
  });
}

function userError_(message) {
  var error = new Error(message);
  error.isUserError = true;
  return error;
}
