(function () {
  "use strict";

  var RECIPIENT = "zzy951642853@gmail.com";
  var MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
  var dialog = null;
  var form = null;
  var status = null;

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
      action: "https://formsubmit.co/" + RECIPIENT,
      method: "POST",
      enctype: "multipart/form-data",
      target: "_blank",
      rel: "noopener"
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
    actions.appendChild(element("button", { type: "submit", className: "feedback-button feedback-button--primary" }, "提交意见"));
    form.appendChild(actions);

    form.addEventListener("submit", function (event) {
      updatePageContext();
      if (!validateAttachment()) {
        event.preventDefault();
        return;
      }
      setStatus(
        isTraditional() ? "正在打開提交頁面……" : "正在打开提交页面……"
      );
    });

    return form;
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
