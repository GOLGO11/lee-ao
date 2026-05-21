(function () {
  "use strict";

  var STORAGE_KEY = "leeao:script-variant";
  var SIMPLIFIED = "zh-CN";
  var TRADITIONAL = "zh-TW";
  var root = document.documentElement;
  var currentScript = document.currentScript;
  var toggle = null;
  var buttons = {};
  var openCCPromise = null;
  var htmlConverter = null;
  var activeRequest = 0;

  function onReady(callback) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", callback, { once: true });
    } else {
      callback();
    }
  }

  function getSavedVariant() {
    try {
      return localStorage.getItem(STORAGE_KEY) === TRADITIONAL ? TRADITIONAL : SIMPLIFIED;
    } catch (error) {
      return SIMPLIFIED;
    }
  }

  function saveVariant(variant) {
    try {
      localStorage.setItem(STORAGE_KEY, variant);
    } catch (error) {
      // Private browsing modes may block localStorage; the button should still work.
    }
  }

  function assetUrl(filename) {
    var script =
      currentScript ||
      Array.prototype.find.call(document.scripts, function (item) {
        return item.src && /(^|\/)language-toggle\.js(?:[?#].*)?$/.test(item.src);
      });

    return new URL(filename, script ? script.src : document.baseURI).href;
  }

  function loadOpenCC() {
    if (window.OpenCC && typeof window.OpenCC.Converter === "function") {
      return Promise.resolve(window.OpenCC);
    }

    if (!openCCPromise) {
      openCCPromise = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = assetUrl("opencc-cn2t.js");
        script.async = true;
        script.onload = function () {
          if (window.OpenCC && typeof window.OpenCC.Converter === "function") {
            resolve(window.OpenCC);
          } else {
            reject(new Error("OpenCC loaded without a Converter API."));
          }
        };
        script.onerror = function () {
          reject(new Error("Could not load OpenCC converter."));
        };
        document.head.appendChild(script);
      });
    }

    return openCCPromise;
  }

  function markIgnoredNodes() {
    var selector = [
      "script",
      "style",
      "noscript",
      "code",
      "pre",
      "kbd",
      "samp",
      "textarea",
      "svg",
      "canvas",
      ".ignore-opencc"
    ].join(",");

    document.querySelectorAll(selector).forEach(function (element) {
      element.classList.add("ignore-opencc");
    });
  }

  function getHtmlConverter(OpenCC) {
    if (!htmlConverter) {
      markIgnoredNodes();
      root.lang = SIMPLIFIED;
      htmlConverter = OpenCC.HTMLConverter(
        OpenCC.Converter({ from: "cn", to: "tw" }),
        root,
        SIMPLIFIED,
        TRADITIONAL
      );
    }

    return htmlConverter;
  }

  function restoreSimplified() {
    if (htmlConverter) {
      htmlConverter.restore();
    }

    root.lang = SIMPLIFIED;
    root.dataset.leeaoScript = "simplified";
  }

  async function applyVariant(variant, requestId) {
    if (variant === TRADITIONAL) {
      var OpenCC = await loadOpenCC();
      if (requestId !== activeRequest) return;

      getHtmlConverter(OpenCC).convert();
      root.dataset.leeaoScript = "traditional";
      return;
    }

    restoreSimplified();
  }

  function setBusy(isBusy) {
    if (!toggle) return;

    toggle.classList.toggle("is-busy", isBusy);
    toggle.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  function syncToggle(variant) {
    Object.keys(buttons).forEach(function (key) {
      buttons[key].setAttribute("aria-pressed", key === variant ? "true" : "false");
    });
  }

  async function chooseVariant(variant) {
    var requestId = ++activeRequest;

    saveVariant(variant);
    syncToggle(variant);
    setBusy(true);

    try {
      await applyVariant(variant, requestId);
    } catch (error) {
      console.warn("[leeao] 简繁切换失败：", error);
      saveVariant(SIMPLIFIED);
      restoreSimplified();
      syncToggle(SIMPLIFIED);
    } finally {
      if (requestId === activeRequest) {
        setBusy(false);
      }
    }
  }

  function createButton(variant, label, title) {
    var button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", function () {
      chooseVariant(variant);
    });
    buttons[variant] = button;
    return button;
  }

  function mountToggle() {
    toggle = document.createElement("div");
    toggle.className = "leeao-language-toggle ignore-opencc";
    toggle.setAttribute("role", "group");
    toggle.setAttribute("aria-label", "简繁切换");
    toggle.appendChild(createButton(SIMPLIFIED, "简", "显示简体中文"));
    toggle.appendChild(createButton(TRADITIONAL, "繁", "显示繁体中文"));

    var target =
      document.querySelector(".menu-bar .right-buttons") ||
      document.querySelector("#menu-bar .right-buttons") ||
      document.querySelector(".menu-bar") ||
      document.querySelector("#menu-bar");

    if (target) {
      target.prepend(toggle);
    } else {
      toggle.classList.add("leeao-language-toggle--floating");
      document.body.appendChild(toggle);
    }
  }

  onReady(function () {
    root.lang = SIMPLIFIED;
    root.dataset.leeaoScript = "simplified";
    mountToggle();
    chooseVariant(getSavedVariant());
  });
})();
