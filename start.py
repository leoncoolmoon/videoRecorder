#!/usr/bin/env python3
"""
一个简单的HTTP服务器，默认端口8000。
配置了最宽松的CORS跨域策略，允许任何来源访问。
启动后自动打开默认浏览器。
"""

import http.server
import socketserver
import os
import urllib.parse
import webbrowser
import threading
import time

PORT = 8000

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    """自定义请求处理器，配置最宽松的CORS策略"""
    
    def end_headers(self):
        # 最宽松的CORS头配置
        self.send_header('Access-Control-Allow-Origin', '*')           # 允许任何来源
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH, HEAD')  # 允许所有HTTP方法
        self.send_header('Access-Control-Allow-Headers', '*')          # 允许任何请求头
        self.send_header('Access-Control-Expose-Headers', '*')         # 允许暴露任何响应头
        self.send_header('Access-Control-Allow-Credentials', 'true')   # 允许携带凭证
        self.send_header('Access-Control-Max-Age', '86400')            # 预检请求缓存24小时
        super().end_headers()
    
    def do_OPTIONS(self):
        """处理预检请求（OPTIONS方法）"""
        self.send_response(200)
        self.end_headers()
    
    def log_message(self, format, *args):
        # 美化控制台输出
        print(f"[{self.address_string()}] {format % args}")
    
    def do_GET(self):
        """处理GET请求"""
        parsed_path = urllib.parse.urlparse(self.path)
        path = parsed_path.path
        
        # 如果是根路径，尝试提供index.html
        if path == '/':
            path = '/index.html'
        
        file_path = self.translate_path(path)
        
        if os.path.exists(file_path) and os.path.isfile(file_path):
            super().do_GET()
        else:
            self.send_error(404, f"File not found: {path}")

def open_browser():
    """延迟打开浏览器，确保服务器已启动"""
    time.sleep(1)  # 等待1秒让服务器完全启动
    url = f"http://localhost:{PORT}"
    print(f"\n正在打开默认浏览器: {url}")
    webbrowser.open(url)

def main():
    """启动服务器"""
    # 创建服务器，允许地址重用
    socketserver.TCPServer.allow_reuse_address = True
    
    with socketserver.TCPServer(("", PORT), CustomHTTPRequestHandler) as httpd:
        print("=" * 60)
        print(f"✓ 服务器启动成功！")
        print(f"✓ 监听端口: {PORT}")
        print(f"✓ 访问地址: http://localhost:{PORT}")
        print(f"✓ 当前目录: {os.getcwd()}")
        print(f"✓ CORS策略: 最宽松模式（允许所有跨域请求）")
        print("=" * 60)
        print("按 Ctrl+C 停止服务器\n")
        
        # 在新线程中打开浏览器，避免阻塞服务器
        browser_thread = threading.Thread(target=open_browser, daemon=True)
        browser_thread.start()
        
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\n\n服务器已停止")

if __name__ == "__main__":
    main()