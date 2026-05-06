package media

import (
	"errors"
	"fmt"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"

	"github.com/gin-gonic/gin"
)

func Playground(c *gin.Context) {
	PlaygroundRelay(c, types.RelayFormatOpenAI)
}

func PlaygroundResponses(c *gin.Context) {
	PlaygroundRelay(c, types.RelayFormatOpenAIResponses)
}

func PlaygroundImage(c *gin.Context) {
	PlaygroundRelay(c, types.RelayFormatOpenAIImage)
}

func PlaygroundImageAsync(c *gin.Context) {
	PlaygroundTaskRelay(c)
}

func PlaygroundEmbedding(c *gin.Context) {
	PlaygroundRelay(c, types.RelayFormatEmbedding)
}

func PlaygroundRerank(c *gin.Context) {
	PlaygroundRelay(c, types.RelayFormatRerank)
}

func PlaygroundRelay(c *gin.Context, relayFormat types.RelayFormat) {
	var newAPIError *types.NewAPIError

	defer func() {
		if newAPIError != nil {
			c.JSON(newAPIError.StatusCode, gin.H{
				"error": newAPIError.ToOpenAIError(),
			})
		}
	}()

	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		newAPIError = types.NewError(errors.New("暂不支持使用 access token"), types.ErrorCodeAccessDenied, types.ErrOptionWithSkipRetry())
		return
	}

	userId := c.GetInt("id")

	// Write user context to ensure acceptUnsetRatio is available
	userCache, err := model.GetUserCacheWithContext(c, userId)
	if err != nil {
		newAPIError = types.NewError(err, types.ErrorCodeQueryDataError, types.ErrOptionWithSkipRetry())
		return
	}
	userCache.WriteContext(c)

	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "" {
		usingGroup = userCache.Group
	}
	tempToken := &model.Token{
		UserId:         userId,
		Name:           fmt.Sprintf("playground-%s", usingGroup),
		Group:          usingGroup,
		EnableImageGen: true,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	controller.Relay(c, relayFormat)
}

func PlaygroundTaskRelay(c *gin.Context) {
	useAccessToken := c.GetBool("use_access_token")
	if useAccessToken {
		c.JSON(403, gin.H{
			"code":    "access_denied",
			"message": "暂不支持使用 access token",
		})
		return
	}

	userId := c.GetInt("id")
	userCache, err := model.GetUserCacheWithContext(c, userId)
	if err != nil {
		c.JSON(500, gin.H{
			"code":    "query_user_failed",
			"message": err.Error(),
		})
		return
	}
	userCache.WriteContext(c)

	usingGroup := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	if usingGroup == "" {
		usingGroup = userCache.Group
	}
	tempToken := &model.Token{
		UserId:         userId,
		Name:           fmt.Sprintf("playground-%s", usingGroup),
		Group:          usingGroup,
		UnlimitedQuota: true,
		EnableImageGen: true,
	}
	_ = middleware.SetupContextForToken(c, tempToken)

	controller.RelayTask(c)
}
