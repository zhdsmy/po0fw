// Only the ASUS shell globals used by Module_po0fw.asp.
function E(id) { return document.getElementById(id); }
var tabtitle = [[]];
var tablink = [[]];
function show_menu(hook) {
  hook();
  document.getElementById("TopBanner").innerHTML = "<b>ASUS</b><span>ASUSWRT-Merlin</span>";
  document.getElementById("mainMenu").textContent = "网络工具";
  document.getElementById("subMenu").textContent = "软件中心";
  document.getElementById("tabMenu").textContent = tabtitle.at(-1)[1];
  document.getElementById("footer").textContent = "ASUSWRT-Merlin";
}
function reload_Soft_Center() {
  location.href = "/Module_Softcenter.asp";
}
