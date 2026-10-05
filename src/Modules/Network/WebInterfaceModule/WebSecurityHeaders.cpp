/**
 * @file WebSecurityHeaders.cpp
 * @brief Response security header implementation.
 */

#include "Modules/Network/WebInterfaceModule/WebSecurityHeaders.h"

#include <ESPAsyncWebServer.h>

#include "Core/Security/WebSecurityPolicy.h"

void addWebSecurityHeaders(AsyncWebServerResponse* response, const char* requestPath)
{
    if (!response) return;
    const Security::WebCspProfile profile = Security::cspProfileForPath(requestPath);
    response->addHeader("Content-Security-Policy", Security::contentSecurityPolicy(profile));
    response->addHeader("X-Content-Type-Options", "nosniff");
    response->addHeader("X-Frame-Options", "DENY");
    response->addHeader("Referrer-Policy", "no-referrer");
    response->addHeader("Permissions-Policy",
                        "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    response->addHeader("Cross-Origin-Resource-Policy", "same-origin");
}
