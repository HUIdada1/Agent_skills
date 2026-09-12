"""PyInstaller 的打包入口：exe 从这里进 CLI，python -m agent_skills 的行为保持一致。"""

import sys

from agent_skills.__main__ import main

if __name__ == "__main__":
    sys.exit(main())
