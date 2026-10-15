# -*- coding: utf-8 -*-
"""EqLens MathML -> 真微软 Word 粘贴端到端测试（Python + pywin32）
用法：python word_paste_py.py <mathml文件> <输出docx>
输出 docx 后由调用方解包检查 OMML XML。
"""
import sys, os, time, struct
import win32clipboard as wclip
import win32con
import win32com.client
import pythoncom


def make_cf_html(fragment: str) -> bytes:
    header = "Version:0.9\r\nStartHTML:{0:010d}\r\nEndHTML:{1:010d}\r\nStartFragment:{2:010d}\r\nEndFragment:{3:010d}\r\n"
    pre = "<html><body>\r\n<!--StartFragment-->"
    post = "<!--EndFragment-->\r\n</body></html>"
    frag_b = fragment.encode('utf-8')
    dummy = header.format(0, 0, 0, 0).encode('ascii')
    len_h = len(dummy)
    len_pre = len_h + len(pre.encode('ascii'))
    len_post = len(post.encode('ascii'))
    real_header = header.format(0, len_h + len_pre + len(frag_b) + len_post, len_pre, len_pre + len(frag_b))
    return real_header.encode('ascii') + pre.encode('ascii') + frag_b + post.encode('ascii')


def set_clipboard(mml: str):
    cf_html = make_cf_html(mml)
    wclip.OpenClipboard()
    try:
        wclip.EmptyClipboard()
        wclip.SetClipboardData(wclip.RegisterClipboardFormat("HTML Format"), cf_html)
        wclip.SetClipboardData(win32con.CF_UNICODETEXT, mml)
    finally:
        wclip.CloseClipboard()


def main():
    mml_file, out_docx = sys.argv[1], os.path.abspath(sys.argv[2])
    with open(mml_file, encoding='utf-8') as f:
        mml = f.read()
    if os.path.exists(out_docx):
        os.remove(out_docx)

    set_clipboard(mml)

    had_word = False
    try:
        word = win32com.client.GetActiveObject('Word.Application')
        had_word = True
    except Exception:
        os.startfile(r'C:\Program Files\Microsoft Office\root\Office16\WINWORD.EXE')
        time.sleep(5)
        word = None
        for _ in range(10):
            try:
                word = win32com.client.GetActiveObject('Word.Application')
                break
            except Exception:
                time.sleep(1)

    word.Visible = False
    word.DisplayAlerts = 0
    doc = word.Documents.Add()
    doc.ActiveWindow.Selection.Paste()
    om = doc.OMaths.Count
    mt = 0
    for sh in doc.InlineShapes:
        try:
            if 'Equation' in sh.OLEFormat.ProgID or 'MathType' in sh.OLEFormat.ProgID:
                mt += 1
        except Exception:
            pass
    doc.SaveAs2(out_docx)
    doc.Close(0)
    print('OK OMaths=%d MathTypeOLE=%d Docx=%s' % (om, mt, out_docx))
    if not had_word and word.Documents.Count == 0:
        word.Quit()


if __name__ == '__main__':
    pythoncom.CoInitialize()
    main()
