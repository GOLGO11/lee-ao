(function () {
  "use strict";

  var RECIPIENT = "zzy951642853@gmail.com";
  var RESPONSE_CHANNEL = "leeao-feedback-apps-script";
  var CLIENT_CONFIG = window.LEEAO_FEEDBACK_CONFIG || {};
  var FORM_ENDPOINT = String(CLIENT_CONFIG.endpoint || "").trim();
  var MAX_ATTACHMENT_SIZE = positiveNumber(
    CLIENT_CONFIG.maxAttachmentBytes,
    5 * 1024 * 1024
  );
  var SUBMIT_TIMEOUT = positiveNumber(CLIENT_CONFIG.responseTimeoutMs, 30000);
  var dialog = null;
  var form = null;
  var status = null;
  var submitButton = null;
  var fallbackButton = null;
  var openedAt = Date.now();

  function positiveNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
  }

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function element(tagName, attributes, textContent) {
    var node = document.createElement(tagName);
    Object.keys(attributes || {}).forEach(function (name) {
      if (name === "className") {
        node.className = attributes[name];
      } else {
        node.setAttribute(name, attributes[name]);
      }
    });
    if (textContent) node.textContent = textContent;
    return node;
  }

  function field(labelText, control, optionalText) {
    var wrapper = element("label", { className: "feedback-field" });
    var label = element("span", { className: "feedback-field__label" }, labelText);
    if (optionalText) label.appendChild(element("small", {}, optionalText));
    wrapper.appendChild(label);
    wrapper.appendChild(control);
    return wrapper;
  }

  function hiddenInput(name, value) {
    return element("input", { type: "hidden", name: name, value: value });
  }

  function isTraditional() {
    return document.documentElement.dataset.leeaoScript === "traditional";
  }

  function text(simplified, traditional) {
    return isTraditional() ? traditional : simplified;
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  function endpointIsConfigured() {
    return /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:[?#].*)?$/.test(
      FORM_ENDPOINT
    );
  }

  function validateAttachment() {
    var input = form.elements.attachment;
    var file = input.files && input.files[0];
    if (!file) return true;

    var hasSupportedType = /^image\/(png|jpeg)$/.test(file.type);
    var hasSupportedExtension = /\.(png|jpe?g)$/i.test(file.name);
    if (!hasSupportedType || !hasSupportedExtension) {
      setStatus(text("请上传 PNG 或 JPG 图片。", "請上傳 PNG 或 JPG 圖片。"), true);
      input.value = "";
      return false;
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      var maxMb = Math.floor(MAX_ATTACHMENT_SIZE / 1024 / 1024);
      setStatus(
        text("图片不能超过 " + maxMb + "MB。", "圖片不能超過 " + maxMb + "MB。"),
        true
      );
      input.value = "";
      return false;
    }

    setStatus("");
    return true;
  }

  function closeDialog() {
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function openDialog() {
    openedAt = Date.now();
    setStatus("");
    fallbackButton.hidden = true;

    if (!endpointIsConfigured()) {
      fallbackButton.hidden = false;
      setStatus(
        text(
          "意见箱服务尚未完成部署，请暂时使用邮件发送。",
          "意見箱服務尚未完成部署，請暫時使用郵件傳送。"
        ),
        true
      );
    }

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    form.elements.message.focus();
  }

  function createForm() {
    form = element("form", { className: "feedback-form" });
    form.appendChild(element("input", {
      className: "feedback-honey",
      type: "text",
      name: "website",
      tabindex: "-1",
      autocomplete: "off",
      "aria-hidden": "true"
    }));

    var typeSelect = element("select", { name: "feedbackType" });
    ["内容纠错", "排版或跳转问题", "功能建议", "其他"].forEach(function (value) {
      typeSelect.appendChild(element("option", { value: value }, value));
    });
    form.appendChild(field("意见类型", typeSelect));

    form.appendChild(field("称呼", element("input", {
      type: "text",
      name: "name",
      maxlength: "80",
      autocomplete: "name"
    }), "（可选）"));

    form.appendChild(field("回复邮箱", element("input", {
      type: "email",
      name: "email",
      maxlength: "160",
      autocomplete: "email",
      placeholder: "name@example.com"
    }), "（可选）"));

    form.appendChild(field("意见内容", element("textarea", {
      name: "message",
      rows: "7",
      maxlength: "5000",
      required: "",
      placeholder: "请说明问题所在的书名、章节和具体内容"
    })));

    var attachment = element("input", {
      type: "file",
      name: "attachment",
      accept: "image/png,image/jpeg"
    });
    attachment.addEventListener("change", validateAttachment);
    var maxMb = Math.floor(MAX_ATTACHMENT_SIZE / 1024 / 1024);
    form.appendChild(field(
      "添加图片",
      attachment,
      "（可选，PNG/JPG，最大 " + maxMb + "MB）"
    ));

    status = element("p", {
      className: "feedback-status",
      role: "status",
      "aria-live": "polite"
    });
    form.appendChild(status);

    var actions = element("div", { className: "feedback-actions" });
    var cancel = element(
      "button",
      { type: "button", className: "feedback-button feedback-button--secondary" },
      "取消"
    );
    cancel.addEventListener("click", closeDialog);
    actions.appendChild(cancel);

    fallbackButton = element("button", {
      type: "button",
      className: "feedback-button feedback-button--mail",
      hidden: ""
    }, "改用邮件发送");
    fallbackButton.addEventListener("click", sendWithMailClient);
    actions.appendChild(fallbackButton);

    submitButton = element("button", {
      type: "submit",
      className: "feedback-button feedback-button--primary"
    }, "提交意见");
    actions.appendChild(submitButton);
    form.appendChild(actions);
    form.addEventListener("submit", submitFeedback);
    return form;
  }

  async function submitFeedback(event) {
    event.preventDefault();
    if (!validateAttachment()) return;

    if (!endpointIsConfigured()) {
      fallbackButton.hidden = false;
      setStatus(
        text(
          "意见箱服务尚未完成部署，请暂时使用邮件发送。",
          "意見箱服務尚未完成部署，請暫時使用郵件傳送。"
        ),
        true
      );
      return;
    }

    fallbackButton.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = text("正在提交…", "正在提交…");
    setStatus(text("正在发送意见……", "正在傳送意見……"));

    try {
      var payload = await buildPayload();
      var result = await postToAppsScript(payload);
      if (!result.ok) throw feedbackError(result.message);

      form.reset();
      openedAt = Date.now();
      setStatus(text("意见已发送，谢谢！", "意見已傳送，謝謝！"));
    } catch (error) {
      console.warn("[leeao] 意见箱提交失败：", error);
      showMailFallback(error);
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = text("提交意见", "提交意見");
    }
  }

  async function buildPayload() {
    var file = form.elements.attachment.files && form.elements.attachment.files[0];
    var now = Date.now();
    return {
      version: 1,
      submissionId: createSubmissionId(),
      pageOrigin: window.location.origin || "null",
      feedbackType: form.elements.feedbackType.value,
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim(),
      message: form.elements.message.value.trim(),
      website: form.elements.website.value,
      openedAt: openedAt,
      submittedAt: now,
      attachment: file ? await serializeAttachment(file) : null
    };
  }

  function createSubmissionId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  async function serializeAttachment(file) {
    var bytes = new Uint8Array(await file.arrayBuffer());
    return {
      name: file.name,
      type: file.type,
      size: bytes.byteLength,
      data: toBase64(bytes)
    };
  }

  function postToAppsScript(payload) {
    return new Promise(function (resolve, reject) {
      var frameName = "leeao-feedback-" + payload.submissionId.replace(/[^a-z0-9-]/gi, "");
      var iframe = element("iframe", {
        className: "feedback-transport",
        name: frameName,
        title: "",
        tabindex: "-1",
        "aria-hidden": "true"
      });
      var transport = element("form", {
        className: "feedback-transport",
        action: FORM_ENDPOINT,
        method: "POST",
        target: frameName
      });
      transport.appendChild(hiddenInput("payload", JSON.stringify(payload)));

      var settled = false;
      var timeout = window.setTimeout(function () {
        finish();
        reject(feedbackError(text(
          "服务未在规定时间内返回确认，请稍后重试。",
          "服務未在規定時間內返回確認，請稍後重試。"
        )));
      }, SUBMIT_TIMEOUT);

      function onMessage(event) {
        var data = event.data;
        if (!data || data.channel !== RESPONSE_CHANNEL) return;
        if (data.submissionId !== payload.submissionId) return;
        finish();
        resolve(data);
      }

      function finish() {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeout);
        window.removeEventListener("message", onMessage);
        window.setTimeout(function () {
          iframe.remove();
          transport.remove();
        }, 0);
      }

      window.addEventListener("message", onMessage);
      document.body.appendChild(iframe);
      document.body.appendChild(transport);
      transport.submit();
    });
  }

  function feedbackError(message) {
    var error = new Error(message || "Feedback submission failed.");
    error.userMessage = message;
    return error;
  }

  function showMailFallback(error) {
    var file = form.elements.attachment.files && form.elements.attachment.files[0];
    fallbackButton.textContent = file
      ? text("生成带图片邮件", "產生附圖郵件")
      : text("改用邮件发送", "改用郵件傳送");
    fallbackButton.hidden = false;
    setStatus(
      error && error.userMessage
        ? error.userMessage
        : text(
          "在线提交失败，请使用备用邮件方式。",
          "線上提交失敗，請使用備用郵件方式。"
        ),
      true
    );
  }

  function feedbackBody() {
    return [
      "意见类型：" + form.elements.feedbackType.value,
      "称呼：" + (form.elements.name.value.trim() || "未填写"),
      "回复邮箱：" + (form.elements.email.value.trim() || "未填写"),
      "",
      "意见内容：",
      form.elements.message.value.trim()
    ].join("\r\n");
  }

  async function sendWithMailClient() {
    var file = form.elements.attachment.files && form.elements.attachment.files[0];

    try {
      if (file) {
        await downloadEmailDraft(file);
        setStatus(text(
          "已生成带图片的邮件草稿，请打开下载的 .eml 文件并点击发送。",
          "已產生附圖的郵件草稿，請開啟下載的 .eml 檔案並點擊傳送。"
        ));
      } else {
        var mailto = "mailto:" + RECIPIENT
          + "?subject=" + encodeURIComponent("大李敖全集网站意见")
          + "&body=" + encodeURIComponent(feedbackBody());
        window.location.href = mailto;
        setStatus(text(
          "已打开邮件客户端，请确认后发送。",
          "已開啟郵件程式，請確認後傳送。"
        ));
      }
    } catch (error) {
      console.warn("[leeao] 生成备用邮件失败：", error);
      setStatus(text(
        "无法打开邮件客户端，请将意见直接发送到 " + RECIPIENT + "。",
        "無法開啟郵件程式，請將意見直接傳送到 " + RECIPIENT + "。"
      ), true);
    }
  }

  async function downloadEmailDraft(file) {
    var boundary = "----leeao-feedback-" + Date.now().toString(36);
    var subject = "大李敖全集网站意见";
    var attachment = new Uint8Array(await file.arrayBuffer());
    var message = [
      "To: " + RECIPIENT,
      "Subject: " + encodedHeader(subject),
      "MIME-Version: 1.0",
      "X-Unsent: 1",
      "Content-Type: multipart/mixed; boundary=\"" + boundary + "\"",
      "",
      "--" + boundary,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      foldBase64(toBase64(new TextEncoder().encode(feedbackBody()))),
      "--" + boundary,
      "Content-Type: " + (file.type || "application/octet-stream"),
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment; filename*=UTF-8''" + encodeURIComponent(file.name),
      "",
      foldBase64(toBase64(attachment)),
      "--" + boundary + "--",
      ""
    ].join("\r\n");

    var blob = new Blob([message], { type: "message/rfc822;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = element("a", { href: url, download: "大李敖全集网站意见.eml" });
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function encodedHeader(value) {
    return "=?UTF-8?B?" + toBase64(new TextEncoder().encode(value)) + "?=";
  }

  function toBase64(bytes) {
    var binary = "";
    var chunkSize = 0x8000;
    for (var offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }

  function foldBase64(value) {
    var lines = value.match(/.{1,76}/g);
    return lines ? lines.join("\r\n") : "";
  }

  function mountFeedbackBox() {
    var openButton = element("button", {
      type: "button",
      className: "feedback-open-button",
      title: "打开意见箱",
      "aria-label": "打开意见箱"
    }, "意见箱");
    openButton.addEventListener("click", openDialog);

    var target =
      document.querySelector(".menu-bar .right-buttons") ||
      document.querySelector("#menu-bar .right-buttons") ||
      document.querySelector(".menu-bar") ||
      document.querySelector("#menu-bar");

    if (target) {
      target.prepend(openButton);
    } else {
      openButton.classList.add("feedback-open-button--floating");
      document.body.appendChild(openButton);
    }

    dialog = element("dialog", {
      className: "feedback-dialog",
      "aria-labelledby": "feedback-title"
    });
    var header = element("div", { className: "feedback-dialog__header" });
    header.appendChild(element("h2", { id: "feedback-title" }, "意见箱"));
    var close = element("button", {
      type: "button",
      className: "feedback-dialog__close",
      title: "关闭",
      "aria-label": "关闭意见箱"
    }, "×");
    close.addEventListener("click", closeDialog);
    header.appendChild(close);
    dialog.appendChild(header);
    dialog.appendChild(createForm());
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) closeDialog();
    });
    document.body.appendChild(dialog);
  }

  onReady(mountFeedbackBox);
})();
