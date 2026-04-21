package catalog

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func GetAllPromptRules(c *gin.Context) {
	page := common.GetPageQuery(c)
	keyword := c.Query("keyword")
	rules, total, err := model.GetAllPromptRules(page, keyword)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	page.SetTotal(int(total))
	page.SetItems(rules)
	common.ApiSuccess(c, page)
}

func CreatePromptRule(c *gin.Context) {
	var rule model.PromptRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if rule.Name == "" || rule.Keyword == "" {
		common.ApiErrorMsg(c, "name and keyword cannot be empty")
		return
	}
	if rule.Type != model.PromptRuleTypeReplace && rule.Type != model.PromptRuleTypeKeyword {
		common.ApiErrorMsg(c, "invalid rule type")
		return
	}
	rule.Id = 0
	if err := model.CreatePromptRule(&rule); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rule)
}

func UpdatePromptRule(c *gin.Context) {
	var rule model.PromptRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		common.ApiErrorMsg(c, "invalid request parameters")
		return
	}
	if rule.Id == 0 {
		common.ApiErrorMsg(c, "rule id is required")
		return
	}
	if err := model.UpdatePromptRule(&rule); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, rule)
}

func DeletePromptRule(c *gin.Context) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		common.ApiErrorMsg(c, "invalid id")
		return
	}
	if err := model.DeletePromptRule(id); err != nil {
		common.ApiError(c, err)
		return
	}
	common.ApiSuccess(c, nil)
}
