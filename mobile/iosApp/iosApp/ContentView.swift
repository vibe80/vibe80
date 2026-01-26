import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState

    var body: some View {
        Group {
            if let sessionId = appState.currentSessionId {
                ChatView(sessionId: sessionId)
            } else {
                SessionView()
            }
        }
        .animation(.easeInOut, value: appState.currentSessionId)
    }
}

#Preview {
    ContentView()
        .environmentObject(AppState())
}
