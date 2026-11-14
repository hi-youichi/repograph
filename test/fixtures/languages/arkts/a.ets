@Component
struct Card {
  @State title: string = ''

  build() {
    Column() {
      Text(this.title).fontSize(20)
    }
  }
}

@Builder
function rowCard() {
  Row() {}
}
