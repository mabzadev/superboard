import { ErrorType } from "@melody-auth/shared";
import type { GetUserInfoRes } from "@melody-auth/shared";

import { provideAuth } from "./auth.provider";
import { AuthService } from "./auth.service";

export type UserInfo = GetUserInfoRes;

export { AuthService, provideAuth, ErrorType };
