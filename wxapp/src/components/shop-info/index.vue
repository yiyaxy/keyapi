
<template>
	<view class="cu-card article" :class="card?'':'no-card'" v-if="shopInfo">
		<view class="cu-item">
			<view class="shop-name cuIcon-shop margin-left margin-top-sm" @click="toShopHome(shopInfo.id)">
				<text class="text-sm text-bold margin-left-xs">{{shopInfo.name}}</text></view>
			<view class="content shop-detail margin-top-sm align-center">
				<image :src="shopInfo.imgUrl" mode="aspectFit"></image>
				<view class="text-gray">
					<view class="cuIcon-locationfill location margin-left-xs overflow-2">
						<text class="address text-sm margin-left-xs">{{shopInfo.address}}</text></view>
					<view class="cuIcon-mobilefill mobile margin-left-xs margin-top-xs" :hover-stop-propagation="true" @click="callPhone(shopInfo.phone)">
						<text class="phone text-sm margin-left-xs">{{shopInfo.phone}}</text></view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	
	export default {
		data() {
			return {};
		},

		components: {},
		props: {
			shopInfo: {
				type: Object,
				default: () => ({})
			},
			card: {
				type: Boolean,
				default: true
			}
		},
		methods: {
			//跳转到商铺首页
			toShopHome(id) {
				uni.navigateTo({
					url: '/pages/shop/shop-detail/index?id=' + id
				});
			},

			callPhone(phone) {
				uni.makePhoneCall({
					phoneNumber: phone
				});
			}
		}
	};
</script>
<style>
	.shop-detail image{
		width: 120rpx !important;
		height: 120rpx !important;
	}
	
	.location{
		width: 520rpx;
	}
</style>
