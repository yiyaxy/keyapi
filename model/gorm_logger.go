package model

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// prettyGormLogger 是项目定制的 GORM 日志器。
// 相对 GORM 默认 logger 的改进：
//   - 单行一条，时间/耗时/行数/SQL/位置全部对齐到一行
//   - 错误用红色、慢查询用黄色、普通 SQL（DEBUG 模式）用灰色
//   - 调用位置只显示相对路径 + 行号，不打完整绝对路径
//   - ErrRecordNotFound 静默（业务上它很多时候不是错误）
//
// 级别控制：
//   - 默认 Warn：只有慢查询 + 真错误会打
//   - DEBUG=true → Info：每条 SQL 都打
type prettyGormLogger struct {
	level         logger.LogLevel
	slowThreshold time.Duration
	ignoreNotFound bool
}

func newPrettyGormLogger() logger.Interface {
	level := logger.Warn
	if common.DebugEnabled {
		level = logger.Info
	}
	return &prettyGormLogger{
		level:          level,
		slowThreshold:  500 * time.Millisecond,
		ignoreNotFound: true,
	}
}

// ANSI color escape codes. 终端不支持时仅是少量乱码，不影响内容。
const (
	cReset  = "\033[0m"
	cGray   = "\033[90m"
	cYellow = "\033[33m"
	cRed    = "\033[31m"
	cCyan   = "\033[36m"
	cBold   = "\033[1m"
)

func (l *prettyGormLogger) LogMode(level logger.LogLevel) logger.Interface {
	newL := *l
	newL.level = level
	return &newL
}

func (l *prettyGormLogger) Info(_ context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Info {
		fmt.Printf("%s[GORM]%s %s\n", cCyan, cReset, fmt.Sprintf(msg, data...))
	}
}

func (l *prettyGormLogger) Warn(_ context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Warn {
		fmt.Printf("%s[GORM WARN]%s %s\n", cYellow, cReset, fmt.Sprintf(msg, data...))
	}
}

func (l *prettyGormLogger) Error(_ context.Context, msg string, data ...interface{}) {
	if l.level >= logger.Error {
		fmt.Printf("%s[GORM ERROR]%s %s\n", cRed, cReset, fmt.Sprintf(msg, data...))
	}
}

func (l *prettyGormLogger) Trace(_ context.Context, begin time.Time, fc func() (string, int64), err error) {
	if l.level <= logger.Silent {
		return
	}

	elapsed := time.Since(begin)
	sql, rows := fc()
	sql = compactSQL(sql)
	caller := shortCaller()

	isNotFound := errors.Is(err, gorm.ErrRecordNotFound)
	hasRealErr := err != nil && !(isNotFound && l.ignoreNotFound)
	isSlow := elapsed > l.slowThreshold && l.slowThreshold != 0

	switch {
	case hasRealErr && l.level >= logger.Error:
		// 错误行：红色，两行（错误 + SQL），易于扫描
		fmt.Printf("%s[SQL ERR]%s %s | %s\n    %s%s%s\n",
			cRed, cReset,
			formatTimeAndRows(elapsed, rows),
			caller,
			cRed, sql, cReset,
		)
		fmt.Printf("    %s↳ %s%s\n", cRed, err.Error(), cReset)

	case isSlow && l.level >= logger.Warn:
		fmt.Printf("%s[SQL SLOW]%s %s | %s\n    %s%s%s\n",
			cYellow, cReset,
			formatTimeAndRows(elapsed, rows),
			caller,
			cYellow, sql, cReset,
		)

	case l.level >= logger.Info:
		fmt.Printf("%s[SQL]%s %s | %s%s%s | %s\n",
			cGray, cReset,
			formatTimeAndRows(elapsed, rows),
			cGray, caller, cReset,
			sql,
		)
	}
}

// formatTimeAndRows 把耗时和行数格式化成定宽对齐的短字符串：
//
//	"  12.3ms rows=1  "
func formatTimeAndRows(elapsed time.Duration, rows int64) string {
	ms := float64(elapsed.Microseconds()) / 1000.0
	if rows < 0 {
		return fmt.Sprintf("%6.1fms rows=-", ms)
	}
	return fmt.Sprintf("%6.1fms rows=%d", ms, rows)
}

// compactSQL 压缩 SQL 里的连续空白/换行，便于单行阅读。
// 不做词法分析，只做简单折叠，对 "a\n  b" → "a b" 这种够用。
func compactSQL(sql string) string {
	sql = strings.TrimSpace(sql)
	// 折叠连续空白为单空格
	var b strings.Builder
	b.Grow(len(sql))
	space := false
	for _, r := range sql {
		if r == ' ' || r == '\t' || r == '\n' || r == '\r' {
			if !space {
				b.WriteByte(' ')
				space = true
			}
			continue
		}
		b.WriteRune(r)
		space = false
	}
	return b.String()
}

// shortCaller 走栈找到最近的业务代码调用点（排除 gorm 自己的帧），
// 返回 "pkg/file.go:line" 形式的短路径。
func shortCaller() string {
	for i := 2; i < 15; i++ {
		_, file, line, ok := runtime.Caller(i)
		if !ok {
			break
		}
		// 跳过 gorm 内部栈
		if strings.Contains(file, "gorm.io/") {
			continue
		}
		// 跳过 Go runtime/database/sql 内部
		if strings.Contains(file, "database/sql") || strings.Contains(file, "runtime/") {
			continue
		}
		// 保留最后两级路径：pkg/file.go
		dir, base := filepath.Split(file)
		parent := filepath.Base(filepath.Clean(dir))
		return fmt.Sprintf("%s/%s:%d", parent, base, line)
	}
	return "?"
}
