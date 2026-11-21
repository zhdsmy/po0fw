<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta http-equiv="X-UA-Compatible" content="IE=Edge"/>
<meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
<meta HTTP-EQUIV="Pragma" CONTENT="no-cache"/>
<meta HTTP-EQUIV="Expires" CONTENT="-1"/>
<link rel="shortcut icon" href="images/favicon.png"/>
<link rel="icon" href="images/favicon.png"/>
<title>软件中心 - po0 防火墙加白</title>
<link rel="stylesheet" type="text/css" href="index_style.css"/>
<link rel="stylesheet" type="text/css" href="form_style.css"/>
<link rel="stylesheet" type="text/css" href="css/element.css">
<link rel="stylesheet" type="text/css" href="res/softcenter.css">
<script language="JavaScript" type="text/javascript" src="/js/jquery.js"></script>
<script language="JavaScript" type="text/javascript" src="/state.js"></script>
<script language="JavaScript" type="text/javascript" src="/help.js"></script>
<script language="JavaScript" type="text/javascript" src="/general.js"></script>
<script language="JavaScript" type="text/javascript" src="/popup.js"></script>
<script language="JavaScript" type="text/javascript" src="/res/softcenter.js"></script>
<style>
	input:focus { outline: none; }
	.button_gen:disabled { opacity: 0.35; cursor: not-allowed; }
	#po0fw_status { white-space: pre-wrap; line-height: 1.6; }
</style>
<script>
var dbus = {};
var status_text = "";
var log_text = "";
function init() {
	show_menu(menu_hook);
	get_dbus_data();
	get_status();
	get_log();
}
function menu_hook(title, tab) {
	tabtitle[tabtitle.length - 1] = new Array("", "po0fw");
	tablink[tablink.length - 1] = new Array("", "Module_po0fw.asp");
}
function get_dbus_data() {
	$.ajax({
		type: "GET",
		url: "/_api/po0fw",
		dataType: "json",
		cache: false,
		success: function(data) {
			dbus = data.result[0] || {};
			E("po0fw_enable").checked = dbus["po0fw_enable"] == "1";
			$("#po0fw_notify").val(dbus["po0fw_notify"] || "off");
			$("#po0fw_bark_url").val(dbus["po0fw_bark_url"] || "");
			$("#po0fw_tg_token").val(dbus["po0fw_tg_token"] || "");
			$("#po0fw_tg_chat").val(dbus["po0fw_tg_chat"] || "");
			$("#po0fw_tg_api").val(dbus["po0fw_tg_api"] || "");
			$("#po0fw_proxy").val(dbus["po0fw_proxy"] || "");
			toggle_notify();
			$("#po0fw_token").val(dbus["po0fw_token"] || "");
			$("#po0fw_slot").val(dbus["po0fw_slot"] || "1");
			$("#po0fw_interval").val(dbus["po0fw_interval"] || "5");
			if (dbus["po0fw_version"]) {
				$("#po0fw_version").html("当前版本：" + dbus["po0fw_version"]);
			}
		}
	});
}
function get_status(cb) {
	$.ajax({
		url: "/_temp/po0fw_status.txt",
		type: "GET",
		cache: false,
		dataType: "text",
		success: function(text) {
			status_text = text || "";
			$("#po0fw_status").text(text || "尚未运行");
			if (cb) cb();
		},
		error: function() {
			$("#po0fw_status").text("尚未运行");
			if (cb) cb();
		}
	});
}
function get_log() {
	$.ajax({
		url: "/_temp/po0fw_log.txt",
		type: "GET",
		cache: false,
		dataType: "text",
		success: function(text) {
			var area = E("log_content_text");
			log_text = text || "";
			area.value = text;
			area.scrollTop = area.scrollHeight;
		}
	});
}
function set_buttons(disabled) {
	E("po0fw_apply").disabled = disabled;
	E("po0fw_run").disabled = disabled;
	E("po0fw_clear").disabled = disabled;
	E("po0fw_test").disabled = disabled;
}
// 后端在后台运行（更新重试时最长约 1 分钟），每 2 秒轮询一次，直到状态或日志变化，或满 60 秒
function poll(before, times) {
	get_log();
	get_status(function() {
		if (times > 0 && status_text + log_text == before) {
			setTimeout(function() { poll(before, times - 1); }, 2000);
		} else {
			set_buttons(false);
		}
	});
}
function call(param, fields) {
	set_buttons(true);
	var before = status_text + log_text;
	var id = parseInt(Math.random() * 100000000);
	var postData = {"id": id, "method": "po0fw_config.sh", "params": [param], "fields": fields};
	$.ajax({
		type: "POST",
		url: "/_api/",
		data: JSON.stringify(postData),
		dataType: "json",
		success: function() { poll(before, param == 3 ? 0 : 30); },
		error: function() { set_buttons(false); }
	});
}
// 读取并校验通知设置，不通过时返回 null
function notify_fields() {
	var f = {
		"po0fw_notify": $("#po0fw_notify").val(),
		"po0fw_bark_url": $.trim($("#po0fw_bark_url").val()),
		"po0fw_tg_token": $.trim($("#po0fw_tg_token").val()),
		"po0fw_tg_chat": $.trim($("#po0fw_tg_chat").val()),
		"po0fw_tg_api": $.trim($("#po0fw_tg_api").val()).replace(/\/+$/, ""),
		"po0fw_proxy": $.trim($("#po0fw_proxy").val())
	};
	if (f.po0fw_notify == "bark" && !/^https?:\/\/\S+\/[^\/\s]+\/?$/.test(f.po0fw_bark_url)) {
		alert("Bark 地址格式：https://api.day.app/你的key");
		return null;
	}
	if (f.po0fw_notify == "telegram") {
		if (!/^\d+:[A-Za-z0-9_-]+$/.test(f.po0fw_tg_token)) { alert("Telegram Bot Token 格式：123456789:ABC..."); return null; }
		if (!/^(-?\d+|@[A-Za-z0-9_]+)$/.test(f.po0fw_tg_chat)) { alert("Telegram Chat ID 是数字（群组以 - 开头），或 @频道名"); return null; }
		if (f.po0fw_tg_api && !/^https?:\/\/\S+$/.test(f.po0fw_tg_api)) { alert("Telegram API 地址以 http:// 或 https:// 开头，留空用官方地址"); return null; }
	}
	if (f.po0fw_proxy && !/^(https?|socks4a?|socks5h?):\/\/\S+$/.test(f.po0fw_proxy)) {
		alert("代理格式：http://host:port 或 socks5h://host:port，留空直连");
		return null;
	}
	return f;
}
function po0fw_apply() {
	var token = $.trim($("#po0fw_token").val());
	if ((E("po0fw_enable").checked || token) && !/^pgnfw_[A-Za-z0-9_-]+$/.test(token)) {
		alert("请填写 pgnfw_ 开头的 API token（不要带 @槽位）。");
		return;
	}
	var f = notify_fields();
	if (!f) return;
	f["po0fw_enable"] = E("po0fw_enable").checked ? "1" : "0";
	f["po0fw_token"] = token;
	f["po0fw_slot"] = $("#po0fw_slot").val();
	f["po0fw_interval"] = $("#po0fw_interval").val();
	call(1, f);
}
// 先保存通知设置，再发一条测试通知，结果写在日志里
function po0fw_test() {
	var f = notify_fields();
	if (!f) return;
	if (f.po0fw_notify == "off") { alert("先选择通知渠道。"); return; }
	call(4, f);
}
function toggle_notify() {
	var v = $("#po0fw_notify").val();
	$(".notify_bark").toggle(v == "bark");
	$(".notify_tg").toggle(v == "telegram");
	$(".notify_any").toggle(v != "off");
}
function toggle_secret(id) {
	var input = E(id);
	input.type = input.type == "password" ? "text" : "password";
}
</script>
</head>
<body onload="init();">
	<div id="TopBanner"></div>
	<div id="Loading" class="popup_bg"></div>
	<iframe name="hidden_frame" id="hidden_frame" src="" width="0" height="0" frameborder="0"></iframe>
		<table class="content" align="center" cellpadding="0" cellspacing="0">
			<tr>
				<td width="17">&nbsp;</td>
				<td valign="top" width="202">
					<div id="mainMenu"></div>
					<div id="subMenu"></div>
				</td>
				<td valign="top">
					<div id="tabMenu" class="submenuBlock"></div>
					<table width="98%" border="0" align="left" cellpadding="0" cellspacing="0">
						<tr>
							<td align="left" valign="top">
								<table width="760px" border="0" cellpadding="5" cellspacing="0" bordercolor="#6b8fa3" class="FormTitle" id="FormTitle">
									<tr>
										<td bgcolor="#4D595D" colspan="3" valign="top">
											<div>&nbsp;</div>
											<div class="formfonttitle">网络工具 - po0 防火墙加白 <lable id="po0fw_version"></lable></div>
											<div style="float:right; width:15px; height:25px;margin-top:-20px">
												<img id="return_btn" onclick="reload_Soft_Center();" align="right" style="cursor:pointer;position:absolute;margin-left:-30px;margin-top:-25px;" title="返回软件中心" src="/images/backprev.png" onMouseOver="this.src='/images/backprevclick.png'" onMouseOut="this.src='/images/backprev.png'"></img>
											</div>
											<div style="margin:10px 0 10px 5px;" class="splitLine"></div>
											<div class="SimpleNote">
												<span>1. 把路由器当前公网出口所在的 /24 写入 po0 防火墙白名单的固定槽位，换 IP 时只替换这个槽位。</span><br/>
												<span>2. 每次拨号成功（wan-start）立即更新，另按下面的间隔定时检查。</span><br/>
												<span>3. 通知（Bark 或 Telegram）：槽位网段变化时、连续失败 3 次时、失败后恢复时各发一次。代理只用于通知，加白请求始终直连。</span>
											</div>
											<table width="100%" border="0" align="center" cellpadding="4" cellspacing="0" bordercolor="#6b8fa3" class="FormTable">
												<tr>
													<th width="25%">启用</th>
													<td><input type="checkbox" id="po0fw_enable" /></td>
												</tr>
												<tr>
													<th>API token</th>
													<td>
														<input type="password" id="po0fw_token" class="input_ss_table" style="width:360px;" placeholder="pgnfw_..." autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" />
														<a href="javascript:void(0);" onclick="toggle_secret('po0fw_token');" style="margin-left:6px;">显示</a>
													</td>
												</tr>
												<tr>
													<th>固定槽位</th>
													<td>
														<select id="po0fw_slot" class="input_option">
															<option value="0">0</option>
															<option value="1">1</option>
															<option value="2">2</option>
															<option value="3">3</option>
															<option value="4">4</option>
															<option value="5">5</option>
															<option value="6">6</option>
															<option value="7">7</option>
															<option value="8">8</option>
															<option value="9">9</option>
														</select>
													</td>
												</tr>
												<tr>
													<th>检查间隔</th>
													<td>
														<select id="po0fw_interval" class="input_option">
															<option value="1">1 分钟</option>
															<option value="2">2 分钟</option>
															<option value="5">5 分钟</option>
															<option value="10">10 分钟</option>
															<option value="15">15 分钟</option>
															<option value="30">30 分钟</option>
														</select>
													</td>
												</tr>
												<tr>
													<th>通知渠道</th>
													<td>
														<select id="po0fw_notify" class="input_option" onchange="toggle_notify();">
															<option value="off">关闭</option>
															<option value="bark">Bark</option>
															<option value="telegram">Telegram</option>
														</select>
													</td>
												</tr>
												<tr class="notify_bark">
													<th>Bark 地址</th>
													<td><input type="password" id="po0fw_bark_url" class="input_ss_table" style="width:360px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="https://api.day.app/你的key" /> <a href="javascript:void(0);" onclick="toggle_secret('po0fw_bark_url');" style="margin-left:6px;">显示</a></td>
												</tr>
												<tr class="notify_tg">
													<th>Telegram Bot Token</th>
													<td><input type="password" id="po0fw_tg_token" class="input_ss_table" style="width:360px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="123456789:ABC..." /> <a href="javascript:void(0);" onclick="toggle_secret('po0fw_tg_token');" style="margin-left:6px;">显示</a></td>
												</tr>
												<tr class="notify_tg">
													<th>Telegram Chat ID</th>
													<td><input type="text" id="po0fw_tg_chat" class="input_ss_table" style="width:360px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="数字 ID，群组以 - 开头；或 @频道名" /></td>
												</tr>
												<tr class="notify_tg">
													<th>Telegram API 地址</th>
													<td><input type="text" id="po0fw_tg_api" class="input_ss_table" style="width:360px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="留空用 https://api.telegram.org，可填自建中转" /></td>
												</tr>
												<tr class="notify_any">
													<th>通知代理</th>
													<td><input type="text" id="po0fw_proxy" class="input_ss_table" style="width:360px;" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder="留空直连；如 http://192.168.1.2:7890 或 socks5h://192.168.1.2:7891" /></td>
												</tr>
												<tr>
													<th>运行状态</th>
													<td><div id="po0fw_status">尚未运行</div></td>
												</tr>
											</table>
											<div id="log_content" class="soft_setting_log">
												<textarea cols="63" rows="14" wrap="on" readonly="readonly" id="log_content_text" class="soft_setting_log1" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"></textarea>
											</div>
											<div class="apply_gen">
												<input class="button_gen" id="po0fw_apply" onClick="po0fw_apply()" type="button" value="保存并应用" />
												<input class="button_gen" id="po0fw_run" style="margin-left:10px;" onClick="call(2, {})" type="button" value="立即更新" />
												<input class="button_gen" id="po0fw_test" style="margin-left:10px;" onClick="po0fw_test()" type="button" value="测试通知" />
												<input class="button_gen" id="po0fw_clear" style="margin-left:10px;" onClick="call(3, {})" type="button" value="清空日志" />
											</div>
										</td>
									</tr>
								</table>
							</td>
						</tr>
					</table>
				</td>
				<td width="10" align="center" valign="top"></td>
			</tr>
		</table>
	<div id="footer"></div>
</body>
</html>
