import ctypes, sys
from ctypes import wintypes
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)
except Exception:
    ctypes.windll.user32.SetProcessDPIAware()

user32 = ctypes.windll.user32
gdi32 = ctypes.windll.gdi32

class RECT(ctypes.Structure):
    _fields_ = [("left", wintypes.LONG), ("top", wintypes.LONG), ("right", wintypes.LONG), ("bottom", wintypes.LONG)]

EnumWindowsProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

def find(title):
    found=[]
    def cb(hwnd, lp):
        if user32.IsWindowVisible(hwnd):
            n=user32.GetWindowTextLengthW(hwnd)
            if n:
                b=ctypes.create_unicode_buffer(n+1)
                user32.GetWindowTextW(hwnd,b,n+1)
                if title.lower() in b.value.lower():
                    found.append(hwnd)
        return True
    user32.EnumWindows(EnumWindowsProc(cb),0)
    return found[0] if found else 0

title = sys.argv[2] if len(sys.argv) > 2 else "gui-test"
hwnd=find(title)
if not hwnd:
    print("NO_WINDOW"); sys.exit(2)
user32.SetForegroundWindow(hwnd)
import time; time.sleep(0.3)
r=RECT(); user32.GetWindowRect(hwnd, ctypes.byref(r))
w=r.right-r.left; h=r.bottom-r.top
print(f"RECT={r.left},{r.top},{r.right},{r.bottom} size={w}x{h}")

hwndDC = user32.GetWindowDC(hwnd)
mfcDC = gdi32.CreateCompatibleDC(hwndDC)
hbmp = gdi32.CreateCompatibleBitmap(hwndDC, w, h)
gdi32.SelectObject(mfcDC, hbmp)
PW_RENDERFULLCONTENT = 2
ok = user32.PrintWindow(hwnd, mfcDC, PW_RENDERFULLCONTENT)
print(f"PrintWindow={ok}")
path = sys.argv[1]
from PIL import Image
class BITMAPINFOHEADER(ctypes.Structure):
    _fields_=[("biSize", wintypes.DWORD),("biWidth", wintypes.LONG),("biHeight", wintypes.LONG),
              ("biPlanes", wintypes.WORD),("biBitCount", wintypes.WORD),("biCompression", wintypes.DWORD),
              ("biSizeImage", wintypes.DWORD),("biXPelsPerMeter", wintypes.LONG),("biYPelsPerMeter", wintypes.LONG),
              ("biClrUsed", wintypes.DWORD),("biClrImportant", wintypes.DWORD)]
class BITMAPINFO(ctypes.Structure):
    _fields_=[("bmiHeader", BITMAPINFOHEADER),("bmiColors", wintypes.DWORD*3)]
bmi=BITMAPINFO(); bmi.bmiHeader.biSize=ctypes.sizeof(BITMAPINFOHEADER)
bmi.bmiHeader.biWidth=w; bmi.bmiHeader.biHeight=-h; bmi.bmiHeader.biPlanes=1; bmi.bmiHeader.biBitCount=32
buf=(ctypes.c_ubyte*(w*h*4))()
gdi32.GetDIBits(mfcDC, hbmp, 0, h, buf, ctypes.byref(bmi), 0)
img=Image.frombuffer("RGBA",(w,h),bytes(buf),"raw","BGRA",0,1)
img.save(path)
print(f"saved {path}")
gdi32.DeleteObject(hbmp); gdi32.DeleteDC(mfcDC); user32.ReleaseDC(hwnd, hwndDC)
