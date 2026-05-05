package relay

import (
	"bytes"
	"errors"
	"html/template"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/model"
	relayimagegen "github.com/QuantumNous/new-api/relay/imagegen"

	"github.com/gin-gonic/gin"
)

type publicImageTaskPageData struct {
	Title        string
	TaskID       string
	Status       string
	StatusText   string
	Progress     int
	Created      string
	Completed    string
	ErrorMessage string
	AutoRefresh  bool
	Images       []publicImageTaskImage
}

type publicImageTaskImage struct {
	URL           string
	RevisedPrompt string
}

func PublicImageAsyncTaskPage(c *gin.Context) {
	task, expiresAt, ok := publicImageTaskFromSignedRequest(c)
	if !ok {
		return
	}

	data, err := buildPublicImageTaskPageData(c, task, expiresAt)
	if err != nil {
		publicImageTaskPageError(c, http.StatusInternalServerError, "任务结果解析失败")
		return
	}

	var body bytes.Buffer
	if err := publicImageTaskTemplate.Execute(&body, data); err != nil {
		publicImageTaskPageError(c, http.StatusInternalServerError, "页面渲染失败")
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(http.StatusOK, "text/html; charset=utf-8", body.Bytes())
}

func publicImageTaskFromSignedRequest(c *gin.Context) (*model.Task, int64, bool) {
	taskID := c.Param("task_id")
	expiresRaw := c.Query("expires")
	sig := c.Query("sig")
	if err := relayimagegen.ValidatePublicTaskLink(taskID, expiresRaw, sig, time.Now()); err != nil {
		status := http.StatusForbidden
		message := "链接无效"
		if errors.Is(err, relayimagegen.ErrPublicTaskLinkExpired) {
			message = "链接已过期"
		}
		publicImageTaskPageError(c, status, message)
		return nil, 0, false
	}
	expiresAt, _ := strconv.ParseInt(expiresRaw, 10, 64)

	task, exists, err := model.GetByOnlyTaskId(taskID)
	if err != nil {
		publicImageTaskPageError(c, http.StatusInternalServerError, "任务查询失败")
		return nil, 0, false
	}
	if !exists || task == nil || task.Platform != constant.TaskPlatformImageSyncWrap {
		publicImageTaskPageError(c, http.StatusNotFound, "任务不存在")
		return nil, 0, false
	}
	return task, expiresAt, true
}

func buildPublicImageTaskPageData(c *gin.Context, task *model.Task, expiresAt int64) (publicImageTaskPageData, error) {
	status := imageAsyncStatus(task.Status)
	progress := imageAsyncProgress(task)
	if progress < 0 {
		progress = 0
	}
	if progress > 100 {
		progress = 100
	}
	page := publicImageTaskPageData{
		Title:       "图片生成任务",
		TaskID:      task.TaskID,
		Status:      status,
		StatusText:  publicImageTaskStatusText(task.Status),
		Progress:    progress,
		Created:     publicImageTaskTime(task.SubmitTime),
		Completed:   publicImageTaskTime(task.FinishTime),
		AutoRefresh: task.Status == model.TaskStatusNotStart || task.Status == model.TaskStatusSubmitted || task.Status == model.TaskStatusQueued || task.Status == model.TaskStatusInProgress,
	}

	switch task.Status {
	case model.TaskStatusSuccess:
		images, err := publicImageTaskImages(c, task, expiresAt)
		if err != nil {
			return page, err
		}
		page.Images = images
		if len(page.Images) == 0 {
			page.ErrorMessage = "没有可显示的图片结果"
		}
	case model.TaskStatusFailure:
		page.ErrorMessage = task.FailReason
		if page.ErrorMessage == "" {
			page.ErrorMessage = "图片生成失败"
		}
	}
	return page, nil
}

func publicImageTaskImages(c *gin.Context, task *model.Task, expiresAt int64) ([]publicImageTaskImage, error) {
	var data []dto.ImageData
	if len(task.PrivateData.ImageData) > 0 {
		if err := common.Unmarshal(task.PrivateData.ImageData, &data); err != nil {
			return nil, err
		}
	}
	data = filterDisplayableImageData(data)
	if len(data) == 0 && task.PrivateData.ResultURL != "" {
		data = append(data, dto.ImageData{Url: task.PrivateData.ResultURL})
	}

	images := make([]publicImageTaskImage, 0, len(data))
	baseURL := imageToolPublicBaseURL(c, publicImageTaskTenantID(task))
	for i, item := range data {
		imageURL := ""
		if item.Url != "" {
			if storageURL, ok, err := presignStoredImageURL(item.Url); err != nil {
				return nil, err
			} else if ok {
				imageURL = storageURL
			} else {
				imageURL = relayimagegen.PublicTaskContentURL(baseURL, task.TaskID, i, expiresAt)
			}
		} else if item.B64Json != "" {
			imageURL = "data:image/png;base64," + item.B64Json
		}
		if imageURL == "" {
			continue
		}
		images = append(images, publicImageTaskImage{
			URL:           imageURL,
			RevisedPrompt: item.RevisedPrompt,
		})
	}
	return images, nil
}

func publicImageTaskTenantID(task *model.Task) int {
	if task == nil || task.PrivateData.TokenId <= 0 {
		return 0
	}
	token, err := model.GetTokenById(task.PrivateData.TokenId)
	if err != nil || token == nil {
		return 0
	}
	return token.TenantId
}

func publicImageTaskStatusText(status model.TaskStatus) string {
	switch status {
	case model.TaskStatusSuccess:
		return "生成完成"
	case model.TaskStatusFailure:
		return "生成失败"
	case model.TaskStatusInProgress:
		return "正在生成"
	default:
		return "已提交，等待生成"
	}
}

func publicImageTaskTime(ts int64) string {
	if ts <= 0 {
		return ""
	}
	return time.Unix(ts, 0).Format("2006-01-02 15:04:05")
}

func publicImageTaskPageError(c *gin.Context, status int, message string) {
	data := publicImageTaskPageData{
		Title:       "图片生成任务",
		StatusText:  message,
		Progress:    0,
		AutoRefresh: false,
	}
	var body bytes.Buffer
	if err := publicImageTaskTemplate.Execute(&body, data); err != nil {
		c.String(status, message)
		return
	}
	c.Header("Cache-Control", "no-store")
	c.Data(status, "text/html; charset=utf-8", body.Bytes())
}

var publicImageTaskTemplate = template.Must(template.New("public_image_task").Parse(`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  {{if .AutoRefresh}}<meta http-equiv="refresh" content="3">{{end}}
  <title>{{.Title}}</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f7f7f5; color: #1f2933; }
    main { width: min(920px, calc(100vw - 32px)); margin: 48px auto; }
    .panel { background: #fff; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px; box-shadow: 0 10px 30px rgba(15, 23, 42, .06); }
    h1 { margin: 0 0 16px; font-size: 24px; line-height: 1.25; }
    .status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 999px; background: #eef6ff; color: #0958a5; font-size: 14px; }
    .meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 20px 0; }
    .meta div { background: #f9fafb; border: 1px solid #edf0f2; border-radius: 6px; padding: 12px; }
    .label { color: #667085; font-size: 12px; margin-bottom: 5px; }
    .value { overflow-wrap: anywhere; font-size: 14px; }
    .bar { height: 8px; background: #e5e7eb; border-radius: 999px; overflow: hidden; margin: 16px 0 8px; }
    .bar span { display: block; height: 100%; background: #2563eb; width: {{.Progress}}%; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin-top: 22px; }
    figure { margin: 0; }
    img { width: 100%; border-radius: 8px; border: 1px solid #e5e7eb; background: #f3f4f6; display: block; }
    figcaption { color: #475467; font-size: 13px; line-height: 1.5; margin-top: 8px; overflow-wrap: anywhere; }
    a { color: #175cd3; text-decoration: none; font-size: 14px; }
    .error { margin-top: 18px; color: #b42318; background: #fff1f0; border: 1px solid #ffdad6; border-radius: 6px; padding: 12px; }
    .hint { color: #667085; font-size: 14px; margin-top: 14px; }
  </style>
</head>
<body>
  <main>
    <section class="panel">
      <h1>{{.Title}}</h1>
      <div class="status">{{.StatusText}}</div>
      {{if .TaskID}}
      <div class="meta">
        <div><div class="label">任务 ID</div><div class="value">{{.TaskID}}</div></div>
        <div><div class="label">进度</div><div class="value">{{.Progress}}%</div></div>
        {{if .Created}}<div><div class="label">提交时间</div><div class="value">{{.Created}}</div></div>{{end}}
        {{if .Completed}}<div><div class="label">完成时间</div><div class="value">{{.Completed}}</div></div>{{end}}
      </div>
      <div class="bar"><span></span></div>
      {{end}}
      {{if .ErrorMessage}}<div class="error">{{.ErrorMessage}}</div>{{end}}
      {{if .Images}}
      <div class="grid">
        {{range .Images}}
        <figure>
          <img src="{{.URL}}" alt="generated image">
          <figcaption><a href="{{.URL}}" target="_blank" rel="noopener">打开原图</a>{{if .RevisedPrompt}}<br>{{.RevisedPrompt}}{{end}}</figcaption>
        </figure>
        {{end}}
      </div>
      {{end}}
      {{if .AutoRefresh}}<p class="hint">页面会自动刷新，生成完成后会显示图片。</p>{{end}}
    </section>
  </main>
</body>
</html>`))
