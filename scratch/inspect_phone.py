import re, os

exe_path = r"C:\Program Files\WindowsApps\Microsoft.YourPhone_1.26082.121.0_x64__8wekyb3d8bbwe\PhoneExperienceHost.exe"
with open(exe_path, "rb") as f:
    data = f.read()

# search ASCII
ascii_matches = set(re.findall(rb"ms-phone:[^\x00\"'\s<>]+", data))
for m in ascii_matches:
    print("ASCII:", m.decode("latin1", errors="ignore"))

# search UTF-16 strings
utf16_matches = re.findall(rb"(?:[\x20-\x7e]\x00){3,}", data)
for raw in set(utf16_matches):
    try:
        s = raw.decode("utf-16le", errors="ignore")
        if any(k in s.lower() for k in ["ms-phone", "tel:", "phonecall", "dial", "call?"]):
            if len(s) < 120:
                print("UTF-16:", s)
    except:
        pass
