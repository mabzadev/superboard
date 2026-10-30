import { BatteryFull, Signal, Wifi } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

export const PAYWALL_DEVICES = {
	"iphone-16-pro": {
		name: "iPhone 16 Pro",
		width: 402,
		height: 874,
		frame: "island",
		top: 62,
		bottom: 34,
		bezel: 12,
	},
	"iphone-16-pro-max": {
		name: "iPhone 16 Pro Max",
		width: 440,
		height: 956,
		frame: "island",
		top: 62,
		bottom: 34,
		bezel: 12,
	},
	"iphone-15-pro": {
		name: "iPhone 15 Pro",
		width: 393,
		height: 852,
		frame: "island",
		top: 59,
		bottom: 34,
		bezel: 12,
	},
	"iphone-se": {
		name: "iPhone SE",
		width: 375,
		height: 667,
		frame: "home",
		top: 20,
		bottom: 0,
		bezel: 12,
	},
	"ipad-pro-11": {
		name: "iPad Pro 11″",
		width: 834,
		height: 1194,
		frame: "tablet",
		top: 24,
		bottom: 20,
		bezel: 22,
	},
} as const;
export type PaywallDeviceKey = keyof typeof PAYWALL_DEVICES;
export function isPaywallDevice(value: string): value is PaywallDeviceKey {
	return Object.hasOwn(PAYWALL_DEVICES, value);
}

export function deviceDimensions(key: PaywallDeviceKey, landscape: boolean) {
	const device = PAYWALL_DEVICES[key];
	const width = landscape ? device.height : device.width;
	const height = landscape ? device.width : device.height;
	const horizontal = device.frame === "home" && landscape ? 58 : device.bezel;
	const vertical = device.frame === "home" && !landscape ? 58 : device.bezel;
	return {
		width,
		height,
		horizontal,
		vertical,
		outerWidth: width + horizontal * 2 + 4,
		outerHeight: height + vertical * 2 + 4,
	};
}

export function PaywallDevice({
	deviceKey,
	landscape,
	theme,
	label,
	children,
}: {
	deviceKey: PaywallDeviceKey;
	landscape: boolean;
	theme: { background_color: string; text_color: string; font_family: string };
	label: string;
	children: ReactNode;
}) {
	const device = PAYWALL_DEVICES[deviceKey];
	const size = deviceDimensions(deviceKey, landscape);
	return (
		<div
			className="paywall-device"
			data-frame={device.frame}
			data-landscape={landscape}
			style={{
				width: size.outerWidth,
				height: size.outerHeight,
				paddingInline: size.horizontal,
				paddingBlock: size.vertical,
			}}
		>
			<span className="paywall-hardware-power" aria-hidden="true" />
			<span className="paywall-hardware-volume" aria-hidden="true" />
			{device.frame === "home" && (
				<>
					<span className="paywall-hardware-speaker" aria-hidden="true" />
					<span className="paywall-hardware-home" aria-hidden="true" />
				</>
			)}
			{device.frame === "tablet" && <span className="paywall-hardware-camera" aria-hidden="true" />}
			<div
				className="paywall-device-screen"
				aria-label={label}
				style={
					{
						width: size.width,
						height: size.height,
						background: theme.background_color,
						color: theme.text_color,
						fontFamily: theme.font_family,
						"--device-safe-top": `${landscape ? 24 : device.top}px`,
						"--device-safe-bottom": `${landscape ? Math.min(device.bottom, 21) : device.bottom}px`,
						"--device-safe-side": `${landscape && device.frame === "island" ? device.top : 0}px`,
					} as CSSProperties
				}
			>
				{device.frame === "island" && (
					<span className="paywall-hardware-island" aria-hidden="true">
						<i />
					</span>
				)}
				<div className="paywall-device-status" aria-hidden="true">
					<span>9:41</span>
					<span className="flex items-center gap-1">
						<Signal size={16} />
						<Wifi size={16} />
						<BatteryFull size={21} />
					</span>
				</div>
				<div className="paywall-device-content">{children}</div>
				{device.bottom > 0 && (
					<div className="paywall-device-safe-bottom" aria-hidden="true">
						<span />
					</div>
				)}
			</div>
		</div>
	);
}
