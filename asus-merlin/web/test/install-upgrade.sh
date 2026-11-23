#!/bin/sh
# Before running: asus-merlin/build.sh (builds the package and the npm dependencies).
set -eu
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
version=$(cat po0fw/version)
mkdir -p "$work/packages" "$work/build/web"
cp "../dist/po0fw-$version.tar.gz" "$work/packages/a.tar.gz"
git -C .. archive --format=tar.gz --prefix=po0fw/ da300bd9c307044092652a4cb4dcebce8368e4e4:asus-merlin/po0fw > "$work/packages/legacy.tar.gz"

# Build a second package at the same version with a different CSS payload.
tar -xzf "$work/packages/a.tar.gz" -C "$work/build"
cp po0fw/webs/Module_po0fw.asp "$work/build/po0fw/webs/"
cp -R web/src web/build.mjs web/package.json web/tsconfig.json "$work/build/web/"
ln -s "$PWD/web/node_modules" "$work/build/web/node_modules"
echo ':host { --test-package: other; }' >> "$work/build/web/src/styles.css"
(cd "$work/build/web" && node build.mjs) >/dev/null
cp "$work/build/web/dist/Module_po0fw.asp" "$work/build/po0fw/webs/"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$work/packages/b.tar.gz" -C "$work/build" po0fw

docker run --rm -i --network none -v "$work/packages:/packages:ro" \
    -v "$PWD/test/mock/bin:/mock/bin:ro" -v "$PWD/test/mock/koolshare/base.sh:/base.sh:ro" \
    busybox:1.25 sh -eu <<'ASH'
for package in legacy a b; do
    mkdir -p "/tmp/$package"
    tar xzf "/packages/$package.tar.gz" -C "/tmp/$package"
done
res=/koolshare/res
page=/koolshare/webs/Module_po0fw.asp
mkdir -p /koolshare/webs "$res" /koolshare/scripts /koolshare/init.d /state
cp /base.sh /koolshare/scripts/base.sh
cat >> /koolshare/scripts/base.sh <<'STUBS'
echo_date() { echo "$@"; }
command() { touch /state/used-command; return 127; }
STUBS
export PATH=/mock/bin:$PATH
dbus set po0fw_enable=0
dbus set po0fw_slot=9
touch "$res/unrelated.js" "$res/po0fw-app.notes.css"

check_build() {
    dir=/tmp/$1/po0fw
    cmp "$dir/webs/Module_po0fw.asp" "$page"
    [ ! -e /koolshare/webs/.po0fw-app.new ]
    set -- "$dir"/res/po0fw-app.*.js
    [ "$#" = 1 ]
    [ -s "$1" ]
    js=${1##*/}
    css=${js%.js}.css
    grep -Fq "src=\"/res/$js\"" "$page"
    cmp "$dir/res/$js" "$res/$js"
    cmp "$dir/res/$css" "$res/$css"
    expected=$(printf '%s\n' "$js" "$css" icon-po0fw.png unrelated.js po0fw-app.notes.css | sort)
    [ "$(ls -1A "$res" | sort)" = "$expected" ]
    [ "$(dbus get po0fw_slot)" = 9 ]
    [ "$(dbus get po0fw_version)" = "$(cat "$dir/version")" ]
}

sh /tmp/legacy/po0fw/install.sh
[ "$(dbus get po0fw_version)" = 1.1.2 ]
# The previous fixed-name test bundle may also have been installed on this router.
touch "$res/po0fw-app.js" "$res/po0fw-app.css"
for package in a b a a; do
    sh "/tmp/$package/po0fw/install.sh"
    check_build "$package"
done
# Overlapping installers may finish in either order; their page and pair must agree.
sh /tmp/a/po0fw/install.sh & first=$!
sh /tmp/b/po0fw/install.sh & second=$!
wait "$first"
wait "$second"
if cmp -s /tmp/a/po0fw/webs/Module_po0fw.asp "$page"; then check_build a; else check_build b; fi
sh /tmp/a/po0fw/install.sh
check_build a
# Firmware should keep serving A even when publishing B fails at the last rename.
mkdir /reject
cat > /reject/mv <<'STUB'
#!/bin/sh
[ "$3" != /koolshare/webs/Module_po0fw.asp ] || exit 1
exec /bin/mv "$@"
STUB
chmod +x /reject/mv
if PATH=/reject:$PATH sh /tmp/b/po0fw/install.sh; then exit 1; fi
check_build a
# Incomplete packages must leave the current ASP and assets usable.
rm /tmp/b/po0fw/res/po0fw-app.*.css
if sh /tmp/b/po0fw/install.sh; then exit 1; fi
check_build a
# A failed script publish must fail the install and keep the running script whole.
cat > /reject/mv <<'STUB'
#!/bin/sh
[ "$3" != /koolshare/scripts/po0fw_config.sh ] || exit 1
exec /bin/mv "$@"
STUB
echo '# stale' >> /koolshare/scripts/po0fw_config.sh
cp /koolshare/scripts/po0fw_config.sh /tmp/stale.sh
dbus set po0fw_version=stale
if PATH=/reject:$PATH sh /tmp/a/po0fw/install.sh; then exit 1; fi
cmp /tmp/stale.sh /koolshare/scripts/po0fw_config.sh
[ ! -e /koolshare/scripts/.po0fw-app.new ]
[ "$(dbus get po0fw_version)" = stale ]
sh /tmp/a/po0fw/install.sh
check_build a
cmp /tmp/a/po0fw/scripts/po0fw_config.sh /koolshare/scripts/po0fw_config.sh
[ -x /koolshare/scripts/po0fw_config.sh ] && [ -x /koolshare/scripts/uninstall_po0fw.sh ]

# An update queued behind a running one during uninstall must not write anything back.
dbus set po0fw_token=pgnfw_TESTtoken123
printf '%s\n' 200 '{"enabled":true,"whitelist":[{"ip":"203.0.113.0\\/24","slot":9}]}' > /state/resp.1
echo 1 > /state/real_sleep
echo 4 > /state/curl_sleep
/koolshare/scripts/po0fw_config.sh run web & holder=$!
/bin/busybox sleep 1
/koolshare/scripts/po0fw_config.sh run web & waiter=$!
/bin/busybox sleep 1
touch "$res/po0fw-app.js" "$res/po0fw-app.css" "$res/po0fw-app.0123456789abcdef0123.js"
touch "$res/.po0fw-app.new" /koolshare/webs/.po0fw-app.new
sh /koolshare/scripts/uninstall_po0fw.sh
wait "$holder"
wait "$waiter" || [ $? = 2 ]
[ -z "$(dbus list po0fw_)" ]
[ ! -e /tmp/upload/po0fw_status.txt ]
rm -f /state/real_sleep /state/curl_sleep
# flock is not FIFO, so the waiter above may run before the uninstall. Replay the
# other order: a process whose script is already gone acquires the lock afterwards.
calls=$(cat /state/curl_n)
dbus set po0fw_token=pgnfw_TESTtoken123
if sh /tmp/a/po0fw/scripts/po0fw_config.sh run web; then exit 1; fi
dbus remove po0fw_token
[ "$(cat /state/curl_n)" = "$calls" ]
[ -z "$(dbus list po0fw_)" ]
[ ! -e /tmp/upload/po0fw_status.txt ]

# Uninstall also removes historical leftovers from an interrupted older install.
[ ! -e "$page" ]
[ ! -e /koolshare/webs/.po0fw-app.new ]
[ "$(ls -1A "$res" | sort)" = "$(printf '%s\n' po0fw-app.notes.css unrelated.js)" ]
[ ! -e /state/used-command ]
echo 'PASS 1.1.2 -> A -> B -> A -> A, failed switch, incomplete package, failed script publish, uninstall during queued update; unrelated files preserved'
ASH
