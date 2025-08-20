#!/usr/bin/env python3
"""
Debug script to capture detailed server output
"""

import os
import sys
import json
import subprocess
import threading
import time
from pathlib import Path

def main():
    # Set headless mode
    os.environ["HEADLESS"] = "1"
    
    # Path to the MCP server binary
    server_path = Path(__file__).parent / "../../build/publish/overlay-companion-mcp"
    
    print(f"Starting MCP server at: {server_path}")
    
    # Start the server process
    process = subprocess.Popen(
        [str(server_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=0
    )
    
    # Function to read stderr in a separate thread
    stderr_output = []
    def read_stderr():
        while True:
            line = process.stderr.readline()
            if not line:
                break
            stderr_output.append(line.strip())
            print(f"STDERR: {line.strip()}")
    
    stderr_thread = threading.Thread(target=read_stderr, daemon=True)
    stderr_thread.start()
    
    try:
        # Wait a moment for server to start
        time.sleep(1)
        
        # Send initialize request
        init_request = {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "clientInfo": {"name": "debug-test", "version": "1.0.0"},
                "capabilities": {}
            }
        }
        
        print("Sending initialize request...")
        process.stdin.write(json.dumps(init_request) + "\n")
        process.stdin.flush()
        
        # Read response
        response_line = process.stdout.readline()
        print(f"Initialize response: {response_line.strip()}")
        
        # Wait a moment
        time.sleep(1)
        
        # Send tools/list request
        tools_request = {
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list",
            "params": {}
        }
        
        print("Sending tools/list request...")
        process.stdin.write(json.dumps(tools_request) + "\n")
        process.stdin.flush()
        
        # Try to read response with timeout
        print("Waiting for tools/list response...")
        time.sleep(2)
        
        # Check if process is still running
        if process.poll() is not None:
            print(f"Process exited with code: {process.poll()}")
        else:
            print("Process is still running")
            
            # Try to read any available output
            try:
                response_line = process.stdout.readline()
                if response_line:
                    print(f"Tools response: {response_line.strip()}")
                else:
                    print("No response received")
            except:
                print("Error reading response")
        
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        # Cleanup
        try:
            process.terminate()
            process.wait(timeout=5)
        except:
            process.kill()
        
        print("\nAll stderr output:")
        for line in stderr_output:
            print(f"  {line}")

if __name__ == "__main__":
    main()