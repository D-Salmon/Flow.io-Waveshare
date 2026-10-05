#pragma once
/**
 * @file WebSecurityHeaders.h
 * @brief Response security headers with route-specific CSP profiles.
 */

class AsyncWebServerResponse;

void addWebSecurityHeaders(AsyncWebServerResponse* response, const char* requestPath);
