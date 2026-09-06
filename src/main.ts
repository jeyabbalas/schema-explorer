// Entry point. The application bootstrap is assembled in later commits; this placeholder keeps
// the toolchain verifiable end to end (typecheck, build, dev server) from the first commit.
const root = document.getElementById("app");
if (root) {
  root.textContent = `Schema Explorer ${__APP_VERSION__} (${__COMMIT__})`;
}
