(function () {
  "use strict";

  var RECIPIENT = "zzy951642853@gmail.com";
  var FORM_ENDPOINT = "https://formsubmit.co/ajax/" + RECIPIENT;
  var MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
  var SUBMIT_TIMEOUT = 15000;
  var dialog = null;
  var form = null;
  var status = null;
  var submitButton = null;
  var fallbackButton = null;

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function element(tagName, attributes, text) {
    var node = document.createElement(tagName);
    Object.keys(attributes || {}).forEach(function (name) {
      if (name === "className") {
        node.className = attributes[name];
      } else {
        node.setAttribute(name, attributes[name]);
      }
    });
    if (text) node.textContent = text;
    return node;
  }

  function field(labelText, control, optionalText) {
    var wrapper = element("label", { className: "feedback-field" });
    var label = element("span", { className: "feedback-field__label" }, labelText);
    if (optionalText) {
      label.appendChild(element("small", {}, optionalText));
    }
    wrapper.appendChild(label);
    wrapper.appendChild(control);
    return wrapper;
  }

  function hiddenInput(name, value) {
    return element("input", { type: "hidden", name: name, value: value });
  }

  function currentPageTitle() {
    var heading = document.querySelector("main h1, .content h1");
    return heading ? heading.textContent.trim() : document.title;
  }

  function updatePageContext() {
    form.elements["页面标题"].value = currentPageTitle();
    form.elements["页面地址"].value = window.location.href;
  }

  function isTraditional() {
    return document.documentElement.dataset.leeaoScript === "traditional";
  }

  function setStatus(message, isError) {
    status.textContent = message;
    status.classList.toggle("is-error", Boolean(isError));
  }

  function text(simplified, traditional) {
    return isTraditional() ? traditional : simplified;
  }

  function validateAttachment() {
    var input = form.elements.attachment;
    var file = input.files && input.files[0];
    if (!file) return true;

    var hasSupportedType = /^image\/(png|jpeg)$/.test(file.type);
    var hasSupportedExtension = /\.(png|jpe?g)$/i.test(file.name);
    if (!hasSupportedType && !hasSupportedExtension) {
      setStatus(
        isTraditional() ? "請上傳 PNG 或 JPG 圖片。" : "请上传 PNG 或 JPG 图片。",
        true
      );
      input.value = "";
      return false;
    }

    if (file.size > MAX_ATTACHMENT_SIZE) {
      setStatus(
        isTraditional() ? "圖片不能超過 10MB。" : "图片不能超过 10MB。",
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
    updatePageContext();
    setStatus("");
    fallbackButton.hidden = true;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    form.elements["意见内容"].focus();
  }

  function createForm() {
    form = element("form", {
      className: "feedback-form",
      action: FORM_ENDPOINT,
      method: "POST",
      enctype: "multipart/form-data"
    });

    form.appendChild(hiddenInput("_subject", "大李敖全集网站意见"));
    form.appendChild(hiddenInput("_template", "table"));
    form.appendChild(hiddenInput("页面标题", ""));
    form.appendChild(hiddenInput("页面地址", ""));
    form.appendChild(element("input", {
      className: "feedback-honey",
      type: "text",
      name: "_honey",
      tabindex: "-1",
      autocomplete: "off"
    }));

    var typeSelect = element("select", { name: "意见类型" });
    ["内容纠错", "排版或跳转问题", "功能建议", "其他"].forEach(function (value) {
      typeSelect.appendChild(element("option", { value: value }, value));
    });
    form.appendChild(field("意见类型", typeSelect));

    form.appendChild(field("称呼", element("input", {
      type: "text",
      name: "称呼",
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
      name: "意见内容",
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
    form.appendChild(field("添加图片", attachment, "（可选，PNG/JPG，最大 10MB）"));

    status = element("p", {
      className: "feedback-status",
      role: "status",
      "aria-live": "polite"
    });
    form.appendChild(status);

    var actions = element("div", { className: "feedback-actions" });
    var cancel = element("button", { type: "button", className: "feedback-button feedback-button--secondary" }, "取消");
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
    updatePageContext();
    if (!validateAttachment()) return;

    fallbackButton.hidden = true;
    submitButton.disabled = true;
    submitButton.textContent = text("正在提交…", "正在提交…");
    setStatus(text("正在发送意见……", "正在傳送意見……"));

    var controller = new AbortController();
    var timeout = window.setTimeout(function () {
      controller.abort();
    }, SUBMIT_TIMEOUT);

    try {
      var response = await fetch(FORM_ENDPOINT, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" },
        signal: controller.signal
      });
      var result = null;
      try {
        result = await response.json();
      } catch (error) {
        // Cloudflare error pages are HTML, so a JSON parse failure is expected.
      }

      if (!response.ok || (result && (result.success === false || result.success === "false"))) {
        var submitError = new Error("Feedback service returned HTTP " + response.status);
        submitError.status = response.status;
        throw submitError;
      }

      form.reset();
      updatePageContext();
      setStatus(text("意见已发送，谢谢！", "意見已傳送，謝謝！"));
    } catch (error) {
      console.warn("[leeao] 意见箱在线提交失败：", error);
      showMailFallback(error);
    } finally {
      window.clearTimeout(timeout);
      submitButton.disabled = false;
      submitButton.textContent = text("提交意见", "提交意見");
    }
  }

  function showMailFallback(error) {
    var file = form.elements.attachment.files && form.elements.attachment.files[0];
    var reason = error && error.status
      ? "HTTP " + error.status
      : text("连接超时或服务不可用", "連線逾時或服務不可用");

    fallbackButton.textContent = file
      ? text("生成带图片邮件", "產生附圖郵件")
      : text("改用邮件发送", "改用郵件傳送");
    fallbackButton.hidden = false;
    setStatus(
      text(
        "在线提交失败（" + reason + "），请使用备用邮件方式。",
        "線上提交失敗（" + reason + "），請使用備用郵件方式。"
      ),
      true
    );
  }

  function feedbackBody() {
    return [
      "意见类型：" + form.elements["意见类型"].value,
      "称呼：" + (form.elements["称呼"].value.trim() || "未填写"),
      "回复邮箱：" + (form.elements.email.value.trim() || "未填写"),
      "页面标题：" + form.elements["页面标题"].value,
      "页面地址：" + form.elements["页面地址"].value,
      "",
      "意见内容：",
      form.elements["意见内容"].value.trim()
    ].join("\r\n");
  }

  async function sendWithMailClient() {
    updatePageContext();
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
    var link = element("a", {
      href: url,
      download: "大李敖全集网站意见.eml"
    });
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
    return value.match(/.{1,76}/g).join("\r\n");
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

    dialog = element("dialog", { className: "feedback-dialog", "aria-labelledby": "feedback-title" });
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
