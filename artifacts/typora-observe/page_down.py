import ctypes, time
from ctypes import wintypes
try: ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception: ctypes.windll.user32.SetProcessDPIAware()
user32=ctypes.windll.user32
class RECT(ctypes.Structure):
    _fields_=[("left",wintypes.LONG),("top",wintypes.LONG),("right",wintypes.LONG),("bottom",wintypes.LONG)]
EnumWindowsProc=ctypes.WINFUNCTYPE(wintypes.BOOL,wintypes.HWND,wintypes.LPARAM)
def find(title):
    found=[]
    def cb(hwnd,lp):
        if user32.IsWindowVisible(hwnd):
            n=user32.GetWindowTextLengthW(hwnd)
            if n:
                b=ctypes.create_unicode_buffer(n+1); user32.GetWindowTextW(hwnd,b,n+1)
                if title.lower() in b.value.lower(): found.append(int(hwnd))
        return True
    user32.EnumWindows(EnumWindowsProc(cb),0)
    return found[0] if found else 0
hwnd=find("gui-test")
r=RECT(); user32.GetWindowRect(hwnd,ctypes.byref(r))
user32.SetForegroundWindow(hwnd); time.sleep(0.3)
# click in content center-right
cx=r.left+950; cy=r.top+400
user32.SetCursorPos(cx,cy); time.sleep(0.05)
user32.mouse_event(2,0,0,0,0); time.sleep(0.02); user32.mouse_event(4,0,0,0,0)
time.sleep(0.2)
VK_NEXT=0x22
for i in range(4):
    user32.keybd_event(VK_NEXT,0,0,0); time.sleep(0.03); user32.keybd_event(VK_NEXT,0,2,0); time.sleep(0.25)
print("PAGEDOWN_OK")
