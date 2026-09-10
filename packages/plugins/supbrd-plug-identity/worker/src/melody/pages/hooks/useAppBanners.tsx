import { useState, useCallback, useEffect } from "hono/jsx";

import { InitialProps } from ".";
import { routeConfig } from "../../configs";
import { bannerModel } from "../../models";
import { AuthorizeParams } from "../tools/param";
import { parseResponse } from "../tools/request";

export interface UseAppBannersProps {
	initialProps: InitialProps;
	params: AuthorizeParams;
}

const useAppBanners = ({ initialProps, params }: UseAppBannersProps) => {
	const [appBanners, setAppBanners] = useState<bannerModel.Record[]>([]);

	const fetchAppBanners = useCallback(() => {
		if (!initialProps.enableAppBanner) {
			return;
		}

		fetch(`${routeConfig.IdentityRoute.AppBanners}?client_id=${params.clientId}`, {
			method: "GET",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
			},
		})
			.then(parseResponse)
			.then((response) => {
				const res = response as { banners: bannerModel.Record[] };
				setAppBanners(res.banners);
			});
	}, [initialProps.enableAppBanner, params.clientId]);

	useEffect(() => {
		fetchAppBanners();
	}, [fetchAppBanners]);

	return { appBanners };
};

export default useAppBanners;
