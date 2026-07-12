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
hwnd=find("gui-test"); r=RECT(); user32.GetWindowRect(hwnd,ctypes.byref(r))
user32.SetForegroundWindow(hwnd); time.sleep(0.2)
# try status bar source button positions
for lx,ly in [(1100,1020),(1080,1015),(1120,1025),(1050,1010),(1140,1030)]:
    user32.SetCursorPos(r.left+lx, r.top+ly); time.sleep(0.04)
    user32.mouse_event(2,0,0,0,0); time.sleep(0.02); user32.mouse_event(4,0,0,0,0)
    time.sleep(0.15)
print("SOURCE_BTN_CLICKS")
