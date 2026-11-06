// Samsung TV remote handling (key codes from Samsung's platform.js).
(function () {
  var CH_UP = 427, CH_DOWN = 428, RETURN = 10009, INFO = 457, GUIDE = 458, CH_LIST = 10073;

  var MAP = {};
  MAP[CH_UP] = "PageUp";
  MAP[CH_DOWN] = "PageDown";
  MAP[RETURN] = "Escape";
  MAP[INFO] = "i";
  MAP[GUIDE] = "g";
  MAP[CH_LIST] = "g";

  window.remoteKey = function (e) {
    var k = MAP[e.keyCode];
    if (k) return k;
    if (e.keyCode >= 48 && e.keyCode <= 57) return String(e.keyCode - 48);
    if (e.keyCode === 13) return "Enter";
    return e.key;
  };

  window.exitApp = function () {
    try { tizen.application.getCurrentApplication().exit(); } catch (err) { window.close(); }
  };

  try {
    ["ChannelUp", "ChannelDown", "ChannelList", "Info", "Guide", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"].forEach(function (name) {
      try { tizen.tvinputdevice.registerKey(name); } catch (err) { /* key not available on this model */ }
    });
  } catch (err) { /* not running on a Tizen TV (browser test) */ }
})();
