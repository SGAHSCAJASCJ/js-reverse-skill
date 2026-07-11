(function (win, lib) {
  var flexible = lib.flexible || (lib.flexible = {});
  var dpr, metaEl;
  var doc = win.document;
  var docEl = doc.documentElement;
  if (!dpr) {
    var isIPhone = win.navigator.appVersion.match(/iphone/gi);
    var devicePixelRatio = win.devicePixelRatio;
    if (isIPhone) {
      if (devicePixelRatio >= 3 && (!dpr || dpr >= 3)) {
        dpr = 3
      } else if (devicePixelRatio >= 2 && (!dpr || dpr >= 2)) {
        dpr = 2
      } else {
        dpr = 1
      }
    } else {
      dpr = devicePixelRatio;
      docEl.setAttribute("data-android", '1');
    }
  }

  docEl.setAttribute("data-dpr", dpr);
  if (!metaEl) {
    metaEl = doc.createElement("meta");
    metaEl.setAttribute("name", "viewport");
    metaEl.setAttribute("content", "user-scalable=no,viewport-fit=cover");
    // metaEl.setAttribute("content", "initial-scale=" + scale + ", maximum-scale=" + scale + ", minimum-scale=" + scale + ", user-scalable=no,viewport-fit=cover");
    if (docEl.firstElementChild) {
      docEl.firstElementChild.appendChild(metaEl)
    } else {
      var wrap = doc.createElement("div");
      wrap.appendChild(metaEl);
      doc.write(wrap.innerHTML)
    }
  }

  function IsPC() {
    var userAgentInfo = navigator.userAgent;
    var agents = new Array("Android", "iPhone", "SymbianOS", "Windows Phone", "iPad", "iPod", "OpenHarmony");
    for (var v = 0; v < agents.length; v++) {
      if (userAgentInfo.indexOf(agents[v]) > 0) return false;
    }
    return true;
  }
  function isPortrait() {
    return window.orientation !== 90 && window.orientation !== -90;
  }

  function refreshRem() {
    var width;
    var isPc = IsPC();
    if (isPc) {
      width = 450;
    } else {
      width = window.innerWidth;
    }
    docEl.setAttribute("data-screen-width", width);
    if (isPc) {
      if (width / dpr > 750) {
        width = 750 * dpr;
      }
    } else {
      var portrait = isPortrait();
      var screenWidth = portrait ? window.screen.width : window.screen.height;
      var screenHeight = portrait ? window.screen.height : window.screen.width;
      if (screenWidth / screenHeight >= 0.8) {
        width = 500;
      }
    }
    var rem = width / 10;
    document.documentElement.style.fontSize = rem + "px";
    requestAnimationFrame(() => {
      document.body.style.display = 'none';
      void document.body.offsetHeight;
      document.body.style.display = '';
    });
    flexible.rem = rem
  }

  refreshRem();
  window.addEventListener("resize", function () {
    setTimeout(function () {
      refreshRem()
      setTimeout(function () {
        refreshRem()
      }, 300)
    }, 300)
  });
  flexible.px2rem = function (d) {
    var val = parseFloat(d) / window.lib.flexible.rem;
    if (typeof d === "string" && d.match(/px$/)) {
      val += "rem"
    }
    return val;
  }
})(window, window.lib || (window.lib = {}));