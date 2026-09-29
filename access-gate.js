/**
 * Epose access gate — loads full login/signup module
 */
(function () {
  var s = document.createElement("script");
  s.src = "access-gate-core.js";
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
})();
