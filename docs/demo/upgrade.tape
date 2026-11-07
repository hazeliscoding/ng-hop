# The README demo: a real Claude Code session, recorded with VHS in WSL. Run from /work with `vhs upgrade.tape`.
#
# /work/app is the nebular-blocked eval app (evals/fixtures.mjs), and /work/ng-hop is a clone of this repo. Nothing runs
# from the home folder, so no home-folder path can show. /work/env.sh sets PATH to a Linux Node and CHROME_BIN to a
# Chromium under /work, plus:
#   CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
#   CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1  (no promos in the banner)
#   PS1='$ '
#   alias claude="claude --plugin-dir /work/ng-hop/plugins/ng-hop --setting-sources project --strict-mcp-config
#     --permission-mode auto --model claude-opus-5-5 --settings '{\"spinnerTipsEnabled\":false}'"
#
# VHS can't tell when the agent has finished, so this records past the end, and the GIF is cut where the footage stops
# changing (ffmpeg's freezedetect):
#   ffmpeg -t <end> -i raw.mp4 -vf "setpts=PTS/6,fps=10,scale=1000:-1:flags=lanczos,
#     tpad=stop_mode=clone:stop_duration=10,split[a][b];[a]palettegen=max_colors=48:stats_mode=diff[p];
#     [b][p]paletteuse=dither=none:diff_mode=rectangle" out.gif
#   gifsicle -O3 --lossy=25 -o upgrade.gif out.gif
Output raw.mp4
Set Shell "bash"
Set FontFamily "JetBrains Mono"
Set FontSize 15
Set Width 1240
Set Height 940
Set Padding 14
Set Framerate 4
Set TypingSpeed 45ms

Hide
Type "source /work/env.sh && cd /work/app && clear"
Enter
Sleep 1s
Show
Type "claude"
Enter
Sleep 7s
Type "Upgrade this app to Angular 22."
Sleep 1s
Enter
Sleep 10m
